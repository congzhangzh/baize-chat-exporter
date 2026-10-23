# /// script
# requires-python = ">=3.10"
# dependencies = ["python-xlib"]
# ///
"""Record the BaiZe demo video against the dummy site in demo/site/.

    uv run demo/record.py                 # writes docs/media/demo.{mp4,gif,jpg}
    uv run demo/record.py --shots DIR     # also saves a PNG per scene (debugging)

Everything runs on a private Xvfb display with a throwaway Chrome profile, so
the video never shows the host desktop, accounts or file paths. Real Chrome,
real unpacked extension, real export: only the chat site is a dummy.

How the pieces fit:
- Chrome is driven over --remote-debugging-pipe. Branded Chrome ignores
  --load-extension since 137, but CDP Extensions.loadUnpacked still works
  when --enable-unsafe-extension-debugging is set.
- Mouse input goes through XTEST, not CDP Input.*: the cursor is visible in
  the recording, and a real toolbar click grants activeTab exactly like a
  user's click does. CDP is only used to load the extension, seed storage
  and read element positions.
- localhost is pre-bound to the OpenWebUI adapter by writing
  site_bindings from the service worker, skipping the permission prompt;
  activeTab from the toolbar click covers script injection.
"""

import argparse
import functools
import http.server
import json
import os
import shutil
import signal
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from Xlib import X, display as xdisplay
from Xlib.ext import xtest

REPO = Path(__file__).resolve().parent.parent
SITE = REPO / 'demo' / 'site'
W, H = 1440, 900

# Toolbar geometry of Chrome 152 at 1440px with a fresh profile, measured from
# --shots screenshots. Re-measure if a Chrome update moves the icons.
PUZZLE = (W - 114, 62)
MENU_ENTRY = (W - 288, 204)


# ---------------------------------------------------------------- http
class Handler(http.server.SimpleHTTPRequestHandler):
    exports = None

    def translate_path(self, path):
        if path.startswith('/exports/'):
            rel = http.server.SimpleHTTPRequestHandler.translate_path(self, path[len('/exports'):])
            return str(Path(self.exports) / Path(rel).relative_to(SITE))
        return super().translate_path(path)

    def guess_type(self, path):
        # Chrome downloads text/markdown instead of showing it.
        if str(path).endswith('.md'):
            return 'text/plain; charset=utf-8'
        return super().guess_type(path)

    def log_message(self, *a):
        pass


def serve(exports, port):
    Handler.exports = exports
    srv = http.server.ThreadingHTTPServer(('127.0.0.1', port), functools.partial(Handler, directory=str(SITE)))
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


# ---------------------------------------------------------------- cdp
class CDP:
    """Chrome DevTools Protocol over --remote-debugging-pipe (fd 3/4, NUL framed)."""

    def __init__(self, args, env):
        to_r, self.w = os.pipe()
        self.r, from_w = os.pipe()
        self.proc = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                     pass_fds=(3, 4), preexec_fn=lambda: self._wire(to_r, from_w))
        os.close(to_r)
        os.close(from_w)
        self.buf = b''
        self.id = 0
        self.events = []

    @staticmethod
    def _wire(to_r, from_w):
        # pipe() may already have returned 3 or 4, so go through fresh fds.
        a, b = os.dup(to_r), os.dup(from_w)
        os.dup2(a, 3)
        os.dup2(b, 4)

    def _read(self):
        while b'\0' not in self.buf:
            chunk = os.read(self.r, 1 << 16)
            if not chunk:
                raise RuntimeError('Chrome closed the DevTools pipe')
            self.buf += chunk
        raw, self.buf = self.buf.split(b'\0', 1)
        return json.loads(raw)

    def send(self, method, params=None, session=None):
        self.id += 1
        msg = {'id': self.id, 'method': method, 'params': params or {}}
        if session:
            msg['sessionId'] = session
        os.write(self.w, json.dumps(msg).encode() + b'\0')
        while True:
            m = self._read()
            if m.get('id') == self.id:
                if 'error' in m:
                    raise RuntimeError(f'{method}: {m["error"]["message"]}')
                return m.get('result', {})
            self.events.append(m)

    def attach(self, target_id):
        return self.send('Target.attachToTarget', {'targetId': target_id, 'flatten': True})['sessionId']

    def find_target(self, pred, timeout=10):
        end = time.time() + timeout
        while time.time() < end:
            for t in self.send('Target.getTargets')['targetInfos']:
                if pred(t):
                    return t
            time.sleep(0.2)
        raise TimeoutError('target not found')

    def eval(self, session, expr):
        r = self.send('Runtime.evaluate', {'expression': expr, 'returnByValue': True, 'awaitPromise': True}, session)
        if 'exceptionDetails' in r:
            raise RuntimeError(r['exceptionDetails'].get('text'))
        return r['result'].get('value')


# ---------------------------------------------------------------- mouse
class Mouse:
    def __init__(self, disp):
        self.d = xdisplay.Display(disp)
        self.pos = (W // 2, H // 2)
        self._warp(*self.pos)

    def _warp(self, x, y):
        xtest.fake_input(self.d, X.MotionNotify, x=int(x), y=int(y))
        self.d.sync()

    def move(self, x, y, secs=0.6):
        x0, y0 = self.pos
        steps = max(1, int(secs * 60))
        for i in range(1, steps + 1):
            t = i / steps
            e = t * t * (3 - 2 * t)  # smoothstep: ease in and out like a hand
            self._warp(x0 + (x - x0) * e, y0 + (y - y0) * e)
            time.sleep(secs / steps)
        self.pos = (x, y)

    def click(self, x=None, y=None, secs=0.6):
        if x is not None:
            self.move(x, y, secs)
        time.sleep(0.15)
        xtest.fake_input(self.d, X.ButtonPress, 1)
        self.d.sync()
        time.sleep(0.08)
        xtest.fake_input(self.d, X.ButtonRelease, 1)
        self.d.sync()

    def wheel(self, notches, gap=0.09):
        button = 5 if notches > 0 else 4
        for _ in range(abs(notches)):
            xtest.fake_input(self.d, X.ButtonPress, button)
            xtest.fake_input(self.d, X.ButtonRelease, button)
            self.d.sync()
            time.sleep(gap)


# ---------------------------------------------------------------- helpers
def screen_point(cdp, session, selector):
    """Centre of a DOM element in X screen coordinates."""
    return cdp.eval(session, f'''(() => {{
        const r = document.querySelector({json.dumps(selector)}).getBoundingClientRect();
        const top = window.outerHeight - window.innerHeight;
        const left = (window.outerWidth - window.innerWidth) / 2;
        return [Math.round(window.screenX + left + r.x + r.width / 2),
                Math.round(window.screenY + top + r.y + r.height / 2)];
    }})()''')


def shot(disp, path):
    if path:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'x11grab', '-video_size', f'{W}x{H}',
                        '-i', disp, '-frames:v', '1', str(path)], check=True)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--out', default=str(REPO / 'docs' / 'media'), help='output directory')
    ap.add_argument('--display', default=':97', help='Xvfb display to create')
    ap.add_argument('--chrome', default='google-chrome')
    ap.add_argument('--port', type=int, default=8765, help='port for the dummy site (0 = any free port)')
    ap.add_argument('--shots', help='save a PNG per scene into this directory')
    args = ap.parse_args()

    work = Path(tempfile.mkdtemp(prefix='baize-demo-'))
    downloads = work / 'Downloads'
    downloads.mkdir()
    shots = Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)
    snap = lambda name: shot(args.display, shots / f'{name}.png' if shots else None)

    xvfb = subprocess.Popen(['Xvfb', args.display, '-screen', '0', f'{W}x{H}x24', '-nolisten', 'tcp'],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    rec = None
    cdp = None
    srv = None
    try:
        profile = work / 'profile'
        (profile / 'Default').mkdir(parents=True)
        (profile / 'Default' / 'Preferences').write_text(json.dumps({
            'download': {'default_directory': str(downloads), 'prompt_for_download': False},
            'browser': {'has_seen_welcome_page': True},
        }))
        env = dict(os.environ, DISPLAY=args.display, TMPDIR=str(work), LANGUAGE='en_US')
        cdp = CDP([args.chrome, f'--user-data-dir={profile}', '--no-first-run', '--no-default-browser-check',
                   '--remote-debugging-pipe', '--enable-unsafe-extension-debugging', '--lang=en-US',
                   '--password-store=basic', '--disable-sync', '--hide-crash-restore-bubble',
                   '--disable-features=Translate,DownloadBubbleV2Promo',
                   f'--window-size={W},{H}', '--window-position=0,0', 'about:blank'], env)

        # Started after Chrome: Popen's preexec_fn is not safe once threads exist.
        srv = serve(downloads, args.port)
        port = srv.server_address[1]

        ext = cdp.send('Extensions.loadUnpacked', {'path': str(REPO)})['id']
        sw = cdp.find_target(lambda t: t['type'] == 'service_worker' and ext in t['url'])
        ss = cdp.attach(sw['targetId'])
        bindings = [{'adapter': 'openwebui', 'enabled': True, 'extra': ['http://localhost/*']}]
        cdp.eval(ss, f'chrome.storage.local.set({{site_bindings: {json.dumps(bindings)}}})')

        page = cdp.find_target(lambda t: t['type'] == 'page')
        ps = cdp.attach(page['targetId'])
        cdp.send('Page.enable', session=ps)
        cdp.send('Page.navigate', {'url': f'http://localhost:{port}/'}, ps)
        time.sleep(2.5)
        mouse = Mouse(args.display)
        # Navigation leaves the omnibox focused and its text highlighted.
        mouse.click(W // 2 + 120, 114, 0.01)
        mouse.move(W - 420, H - 330, 0.01)
        snap('01-site')

        raw = work / 'raw.mkv'
        rec = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'x11grab', '-framerate', '30',
                                '-video_size', f'{W}x{H}', '-draw_mouse', '1', '-i', args.display,
                                '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '16', str(raw)],
                               stdin=subprocess.PIPE)
        time.sleep(1.5)

        # Scene 1: a normal chat page; read through the conversation.
        mouse.move(W // 2 + 120, H // 2, 1.0)
        mouse.wheel(10, 0.12)
        time.sleep(0.8)
        mouse.wheel(12, 0.12)
        time.sleep(1.0)

        # Scene 2: open BaiZe from the extensions menu.
        mouse.click(*PUZZLE, 1.1)
        time.sleep(1.0)
        snap('02-menu')
        mouse.click(*MENU_ENTRY, 0.7)
        popup = cdp.find_target(lambda t: t['url'].startswith(f'chrome-extension://{ext}/popup/'))
        pop = cdp.attach(popup['targetId'])
        cdp.send('Runtime.enable', session=pop)
        time.sleep(1.4)
        snap('03-popup')

        # Scene 3: export.
        mouse.click(*screen_point(cdp, pop, '#btn-download'), 0.9)
        md = None
        end = time.time() + 30
        while time.time() < end and not md:
            done = [p for p in downloads.glob('*.md')]
            md = done[0] if done else None
            time.sleep(0.3)
        if not md:
            raise RuntimeError('export did not produce a .md file')
        time.sleep(1.8)
        snap('04-exported')

        # Scene 4: the exported Markdown.
        from urllib.parse import quote
        cdp.send('Target.createTarget', {'url': f'http://localhost:{port}/exports/{quote(md.name)}'})
        time.sleep(1.8)
        mouse.move(W // 2, H // 2 + 40, 0.8)
        snap('05-markdown')
        mouse.wheel(8, 0.14)
        time.sleep(0.8)
        mouse.wheel(14, 0.12)
        time.sleep(0.8)
        mouse.wheel(14, 0.12)
        time.sleep(2.0)
        snap('06-markdown-end')

        rec.communicate(b'q', timeout=30)
        rec = None

        out = Path(args.out)
        out.mkdir(parents=True, exist_ok=True)
        shutil.copy(md, work / 'export.md')
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-vf', 'scale=1280:-2:flags=lanczos,format=yuv420p',
                        '-c:v', 'libx264', '-crf', '26', '-preset', 'slow', '-movflags', '+faststart',
                        str(out / 'demo.mp4')], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(raw), '-vf',
                        'fps=10,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=128[p];[b][p]paletteuse=dither=bayer:bayer_scale=4',
                        str(out / 'demo.gif')], check=True)
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', '3', '-i', str(raw), '-frames:v', '1',
                        '-vf', 'scale=1280:-2', '-q:v', '4', str(out / 'demo.jpg')], check=True)
        if shots:
            shutil.copy(md, shots / 'export.md')
        print(f'exported {md.name}; wrote demo.mp4, demo.gif, demo.jpg to {out}')
    finally:
        if rec:
            rec.kill()
        if cdp:
            cdp.proc.send_signal(signal.SIGTERM)
            try:
                cdp.proc.wait(10)
            except subprocess.TimeoutExpired:
                cdp.proc.kill()
        if srv:
            srv.shutdown()
        xvfb.terminate()
        shutil.rmtree(work, ignore_errors=True)


if __name__ == '__main__':
    sys.exit(main())
