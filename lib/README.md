# Vendored libraries

No build step: these files are checked in as-is and loaded directly by the
extension. This file records their provenance and retains the upstream license
notices that the bundled files themselves are missing.

| File | Project | Version | License |
|---|---|---|---|
| `turndown.min.js` | [mixmark-io/turndown](https://github.com/mixmark-io/turndown) | unpinned (unminified `dist/turndown.js` IIFE build, no in-file version string — pin on next vendor refresh) | MIT |
| `turndown-plugin-gfm.min.js` | [mixmark-io/turndown-plugin-gfm](https://github.com/mixmark-io/turndown-plugin-gfm) | unpinned (unminified dist IIFE build — pin on next vendor refresh) | MIT |
| `jszip.min.js` | [Stuk/jszip](https://github.com/Stuk/jszip) | 3.10.1 (license banner intact in file) | MIT or GPLv3 dual license |

Note: despite the `.min.js` names, both Turndown files are unminified dist
builds. When refreshing any of these, record the exact version and source URL
here, and keep (or restore) the upstream license banner.

## Turndown — MIT License

Copyright (c) 2017 Dom Christie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## turndown-plugin-gfm — MIT License

Copyright (c) 2017+ Dom Christie

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.

## JSZip

JSZip 3.10.1 retains its original license banner at the top of
`jszip.min.js`: dual-licensed under the MIT license or GPLv3, and includes
portions of pako (MIT, (C) 2014-2017 Vitaly Puzrin and Andrey Tupitsin).
