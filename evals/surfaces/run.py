"""Surface bench: deterministic regression checks for scan/act/read/wait/
snapshot across tricky web surfaces (shadow DOM, closed shadow, iframes,
rich ARIA roles, dynamic drawers, forms).

Usage:  python run.py   (or run.cmd)
Needs:  agent-webmcp on PATH (or set AGENT_WEBMCP_BIN), Chrome.
Opens file:// fixtures in session "surf-bench", asserts, closes it.
Exit 0 = all pass, 1 = any failure.
"""
import json
import os
import subprocess
import sys

BIN = os.environ.get('AGENT_WEBMCP_BIN', 'agent-webmcp')
HERE = os.path.dirname(os.path.abspath(__file__))
SESSION = 'surf-bench'
FAILS = []


def cli(*args):
    p = subprocess.run([BIN, *args, '--session', SESSION, '--json'],
                       capture_output=True, text=True, timeout=120)
    try:
        return json.loads(p.stdout or '{}')
    except json.JSONDecodeError:
        return {'ok': False, 'error': f'non-json: {p.stdout[:200]} {p.stderr[:200]}'}


def data(res):
    return (res.get('data') or {}) if res.get('ok') else {}


def check(name, cond, extra=''):
    print(('PASS ' if cond else 'FAIL ') + name +
          ('' if cond or not extra else f' :: {extra}'[:220]))
    if not cond:
        FAILS.append(name)


def find_ref(items, role, name):
    for it in items:
        if it.get('role') == role and it.get('name') == name:
            return it['ref']
    return None


def scan(query=None, hidden=True, limit=100):
    args = ['scan', '--limit', str(limit)]
    if query:
        args += ['--query', query]
    if hidden:
        args += ['--hidden']
    return data(cli(*args)).get('items', [])


def open_fixture(name):
    url = 'file:///' + os.path.join(HERE, name).replace('\\', '/')
    r = cli('open', url)
    check(f'{name}: open', r.get('ok'), str(r.get('error', '')))


# ---- 1. roles ----
open_fixture('roles.html')
items = scan()
for role, name in [('button', 'Copy'), ('button', 'Close dialog'),
                   ('button', 'Save'), ('switch', 'Notifications'),
                   ('slider', 'Volume'), ('tab', 'Overview'),
                   ('tab', 'Details'), ('listbox', 'Choices'),
                   ('option', 'Choice One'), ('combobox', 'Search fruit'),
                   ('spinbutton', 'Quantity'), ('textbox', 'Email'),
                   ('textbox', 'Code caption'), ('select', 'Country'),
                   ('button', 'More info')]:
    check(f'roles: {role}|{name}',
          find_ref(items, role, name) is not None)
cp = next((i for i in items if i.get('name') == 'Copy'), {})
check('roles: Copy grouped x2 with ctx',
      cp.get('n') == 2 and len(cp.get('ctx', [])) == 2, str(cp))
rd = data(cli('read', '--limit', '800'))
check('roles: headings', 'Section A' in (rd.get('headings') or []),
      str(rd.get('headings')))

# ---- 2. open shadow ----
open_fixture('shadow-open.html')
items = scan()
for role, name in [('button', 'Shadow action'),
                   ('switch', 'Shadow toggle'),
                   ('button', 'Nested shadow action'),
                   ('textbox', 'Shadow name')]:
    hit = next((i for i in items
                if i.get('role') == role and i.get('name') == name), None)
    check(f'shadow-open: {role}|{name}', hit is not None)
    check(f'shadow-open: {name} marked sh',
          bool(hit and hit.get('sh')), str(hit))
rd = data(cli('read', '--limit', '800'))
check('shadow-open: read has shadow text',
      'Shadow action' in (rd.get('text') or ''))

# ---- 3. closed shadow ----
open_fixture('shadow-closed.html')
items = scan()
for role, name in [('button', 'Closed action'),
                   ('switch', 'Closed toggle'),
                   ('button', 'Nested-in-closed action'),
                   ('textbox', 'Closed name')]:
    hit = next((i for i in items
                if i.get('role') == role and i.get('name') == name), None)
    check(f'shadow-closed: {role}|{name}', hit is not None)
    check(f'shadow-closed: {name} has cbid',
          bool(hit and hit.get('cbid')), str(hit))
ref = find_ref(items, 'button', 'Closed action')
r = cli('act', 'click', ref)
check('shadow-closed: click done',
      data(r).get('done') is True, str(r))
ref = find_ref(items, 'textbox', 'Closed name')
r = cli('act', 'type', ref, '--text', 'bench-closed')
check('shadow-closed: type done',
      data(r).get('done') is True, str(r))
rd = data(cli('read', '--limit', '800'))
check('shadow-closed: read has closed text',
      'Closed shadow text alpha' in (rd.get('text') or ''))

# ---- 4. frames ----
open_fixture('frames.html')
r = cli('scan', '--limit', '30')
d = data(r)
items = d.get('items', [])
check('frames: Top button',
      find_ref(items, 'button', 'Top button') is not None)
check('frames: Iframe action fp=0',
      next((i for i in items if i.get('name') == 'Iframe action'),
           {}).get('fp') == '0')
check('frames: Deep action fp=1/0',
      next((i for i in items if i.get('name') == 'Deep action'),
           {}).get('fp') == '1/0')
check('frames: tally same=3 blocked=1',
      (d.get('frames') or {}) == {'same': 3, 'blocked': 1},
      str(d.get('frames')))
ref = find_ref(items, 'button', 'Deep action')
r = cli('act', 'click', ref)
check('frames: nested click done', data(r).get('done') is True, str(r))
r = cli('snapshot', '--compact', '--limit', '40')
d = data(r)
names = [x.get('name') for x in d.get('items', []) if 'role' in x]
check('frames: snapshot sees iframe button', 'Iframe action' in names,
      str(names[:12]))

# ---- 5. dynamic ----
open_fixture('dynamic.html')
items = scan(query='Menu')
vis = [i for i in items if i.get('vis')]
check('dynamic: drawer closed, 1 visible + 2 hidden',
      len(items) == 3 and len(vis) == 1,
      str([(i['ref'], i['name'], i.get('vis')) for i in items]))
ref = find_ref(scan(), 'button', 'Show menu')
check('dynamic: act click Show menu',
      data(cli('act', 'click', ref)).get('done') is True)
items = scan(query='Menu')
check('dynamic: drawer open reveals 3',
      len(items) == 3 and all(i.get('vis') for i in items),
      str([(i['ref'], i['name'], i.get('vis')) for i in items]))
ref = find_ref(scan(), 'button', 'Add control')
check('dynamic: act click Add control',
      data(cli('act', 'click', ref)).get('done') is True)
r = data(cli('wait', '--for', 'text=Late'))
check('dynamic: wait text=Late met', r.get('met') is True, str(r))
check('dynamic: Late control scanned',
      find_ref(scan(query='Late'), 'button', 'Late control') is not None)

# ---- 6. form (observe-plan-act path) ----
open_fixture('form.html')
items = scan()
for role, name in [('textbox', 'Username'), ('textbox', 'Password'),
                   ('checkbox', 'Remember me'), ('button', 'Sign in')]:
    check(f'form: {role}|{name}',
          find_ref(items, role, name) is not None)
check('form: type user',
      data(cli('act', 'type', find_ref(items, 'textbox', 'Username'),
                 '--text', 'ada')).get('done') is True)
check('form: type pass',
      data(cli('act', 'type', find_ref(items, 'textbox', 'Password'),
                 '--text', 's3cret')).get('done') is True)
check('form: check remember',
      data(cli('act', 'click',
                 find_ref(items, 'checkbox', 'Remember me'))).get('done')
      is True)
check('form: submit',
      data(cli('act', 'click',
                 find_ref(items, 'button', 'Sign in'))).get('done') is True)
rd = data(cli('read', '--limit', '300'))
check('form: signed in', 'Signed in as ada' in (rd.get('text') or ''),
      (rd.get('text') or '')[:200])

cli('close')
print(f'\n{len(FAILS)} failures' if FAILS else '\nALL PASS')
sys.exit(1 if FAILS else 0)
