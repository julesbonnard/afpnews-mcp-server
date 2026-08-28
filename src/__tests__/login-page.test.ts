import { describe, expect, it } from 'bun:test';
import { buildLoginPage, buildAllowedUris, isAllowedRedirectUri } from '../http/login-page.js';

// Extracts `const NAME = <js-string-literal>;` and JSON.parse()s it back — valid since jsValue()
// only ever emits \uXXXX escapes, which JSON strings support natively too. A successful
// round-trip proves the escaping is reversible (doesn't corrupt the value for legitimate use),
// while the </script> absence checks below prove it can't break out of the <script> element.
function extractConst(html: string, name: string): string {
  const match = html.match(new RegExp(`const ${name} = (".*?(?<!\\\\)");`));
  if (!match) throw new Error(`const ${name} not found in generated HTML`);
  return JSON.parse(match[1]) as string;
}

describe('buildLoginPage — XSS escaping', () => {
  const XSS_BREAKOUT = '</script><script>alert(document.cookie)</script>';

  it('escapes a redirectUri containing a </script> breakout attempt', () => {
    const html = buildLoginPage({ redirectUri: `https://evil.example.com/${XSS_BREAKOUT}`, codeChallenge: 'chall' });
    expect(html.split('<script>')).toHaveLength(2); // only the page's own single <script> block
    expect(extractConst(html, 'REDIRECT_URI')).toBe(`https://evil.example.com/${XSS_BREAKOUT}`);
  });

  it('escapes a codeChallenge containing a </script> breakout attempt (unvalidated by the route)', () => {
    const html = buildLoginPage({ redirectUri: 'https://claude.ai/callback', codeChallenge: XSS_BREAKOUT });
    expect(html.split('<script>')).toHaveLength(2); // only the page's own single <script> block
    expect(extractConst(html, 'CODE_CHALLENGE')).toBe(XSS_BREAKOUT);
  });

  it('escapes a state value containing a </script> breakout attempt (unvalidated by the route)', () => {
    const html = buildLoginPage({ redirectUri: 'https://claude.ai/callback', codeChallenge: 'chall', state: XSS_BREAKOUT });
    expect(html.split('<script>')).toHaveLength(2);
    expect(extractConst(html, 'STATE')).toBe(XSS_BREAKOUT);
  });

  it('escapes a codeChallenge containing double quotes and backslashes', () => {
    const payload = '";alert(document.cookie);//';
    const html = buildLoginPage({ redirectUri: 'https://claude.ai/callback', codeChallenge: payload });
    expect(extractConst(html, 'CODE_CHALLENGE')).toBe(payload);
    // A raw, unescaped quote breaking out of the JS string literal must not appear.
    expect(html).not.toContain('= "";alert(document.cookie);//";');
  });

  it('defaults state to an empty string when omitted', () => {
    const html = buildLoginPage({ redirectUri: 'https://claude.ai/callback', codeChallenge: 'chall' });
    expect(html).toContain('const STATE = "";');
  });

  it('does not embed clientId anywhere (unused by the page)', () => {
    const html = buildLoginPage({
      redirectUri: 'https://claude.ai/callback',
      codeChallenge: 'chall',
      clientId: '<script>alert(1)</script>',
    });
    expect(html.split('<script>')).toHaveLength(2);
  });
});

describe('buildAllowedUris', () => {
  it('returns an empty array when the env var is unset', () => {
    expect(buildAllowedUris({})).toEqual([]);
  });

  it('splits, trims and drops empty entries', () => {
    expect(buildAllowedUris({ MCP_ALLOWED_REDIRECT_URIS: ' https://a.example.com , https://b.example.com,,' })).toEqual([
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });
});

describe('isAllowedRedirectUri', () => {
  it('allows any localhost URI regardless of port, ignoring the whitelist', () => {
    expect(isAllowedRedirectUri('http://localhost:54321/callback', [])).toBe(true);
    expect(isAllowedRedirectUri('http://127.0.0.1:9999/callback', [])).toBe(true);
  });

  it('rejects an https localhost URI (only http: qualifies for the local-client bypass)', () => {
    expect(isAllowedRedirectUri('https://localhost:54321/callback', [])).toBe(false);
  });

  it('allows an exact match against the whitelist', () => {
    expect(isAllowedRedirectUri('https://claude.ai/api/mcp/auth_callback', ['https://claude.ai/api/mcp/auth_callback'])).toBe(true);
  });

  it('rejects a URI not in the whitelist', () => {
    expect(isAllowedRedirectUri('https://evil.example.com/callback', ['https://claude.ai/api/mcp/auth_callback'])).toBe(false);
  });

  it('rejects an unparseable URI instead of throwing', () => {
    expect(isAllowedRedirectUri('not a url', [])).toBe(false);
  });
});
