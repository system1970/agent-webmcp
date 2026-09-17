// Lazy neural search: MiniLM embeddings, WebGPU first, WASM fallback.
// Dynamically imported so the ~MBs of onnxruntime never touch the initial
// bundle, and never run during SSR. Model weights (~23MB q8) download once
// from the HF CDN on first use, then come from browser cache.

export type SemBackend = "webgpu" | "wasm";
export type SemStatus = "idle" | "loading" | "ready" | "failed";

const MODEL = "Xenova/all-MiniLM-L6-v2";

type ExtractFn = (texts: string[]) => Promise<number[][]>;

let cached: Promise<{ extract: ExtractFn; backend: SemBackend }> | null =
  null;

async function create(
  onProgress?: (pct: number) => void
): Promise<{ extract: ExtractFn; backend: SemBackend }> {
  const mod = await import("@huggingface/transformers");
  const attempts: Array<{ device: string; backend: SemBackend }> = [
    { device: "webgpu", backend: "webgpu" },
    { device: "wasm", backend: "wasm" },
  ];
  let lastErr: unknown = null;
  for (const a of attempts) {
    try {
      const pipe = await mod.pipeline("feature-extraction", MODEL, {
        device: a.device as "webgpu",
        dtype: "q8",
        progress_callback: (info: { status?: string; loaded?: number; total?: number }) => {
          if (info?.status === "progress" && info.total) {
            onProgress?.(
              Math.min(99, Math.round(((info.loaded ?? 0) / info.total) * 100))
            );
          }
        },
      });
      // Verify the backend actually executes (WebGPU can fail lazily here).
      const warm = await pipe("warmup probe", {
        pooling: "mean",
        normalize: true,
      });
      (warm as { dispose?: () => void }).dispose?.();
      const extract: ExtractFn = async (texts: string[]) => {
        const out = await pipe(texts, { pooling: "mean", normalize: true });
        return (out as { tolist: () => number[][] }).tolist();
      };
      return { extract, backend: a.backend };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("no semantic backend");
}

export function loadSemantic(
  onProgress?: (pct: number) => void
): Promise<{ extract: ExtractFn; backend: SemBackend }> {
  if (!cached) cached = create(onProgress);
  return cached;
}

/** Cosine similarity; MiniLM outputs are L2-normalized, so this is a dot. */
export function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  let d = 0;
  for (let i = 0; i < n; i++) d += a[i] * b[i];
  if (d < 0) return 0;
  if (d > 1) return 1;
  return d;
}

/** Edit distance ≤ k check with early exit; typo tolerance for keywords. */
export function withinEdit(a: string, b: string, k: number): boolean {
  if (a === b) return true;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > k) return false;
  let prev = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    let cur0 = i;
    let rowMin = cur0;
    let prevDiag = i - 1;
    for (let j = 1; j <= lb; j++) {
      const tmp = prev[j];
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const v = Math.min(prev[j] + 1, cur0 + 1, prevDiag + cost);
      prevDiag = tmp;
      prev[j - 1] = cur0;
      cur0 = v;
      if (v < rowMin) rowMin = v;
    }
    prev[lb] = cur0;
    if (rowMin > k) return false;
  }
  return prev[lb] <= k;
}

const STOP = new Set(
  "how,do,does,did,i,me,my,a,an,the,to,for,of,on,in,with,can,could,would,should,want,need,like,looking,look,get,find,show,give,use,using,used,there,is,are,was,be,and,or,by,from,at,as,it,its,this,that,what,which,who,whom,whose,when,where,please,help,some,any,tell,about,into,over,under,up,out,so,than,too,very,just,now".split(
    ","
  )
);

/** Content tokens: lowercase alnum words minus stopwords. */
export function contentTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0 && !STOP.has(t));
}
