import "./globals.css";

export const metadata = {
  title: "agent-webmcp — ultra-light WebMCP CLI",
  description:
    "Single-binary CLI for discovering and invoking WebMCP tools in real browser sessions.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
