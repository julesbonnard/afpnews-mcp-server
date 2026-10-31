import { describe, expect, it } from 'bun:test';
import { buildLoginPage as buildLoginPageHtml } from '../http/login-page.js';

// buildLoginPage() returns hono/html's HtmlEscapedString (a boxed String, typeof "object")
// so its own escaping pipeline runs correctly — stringify it here for plain-string assertions.
function buildLoginPage(...args: Parameters<typeof buildLoginPageHtml>): string {
  return String(buildLoginPageHtml(...args));
}

// Extracts `data-name="..."` and unescapes the 5 HTML entities hono/html's escaper can produce —
// mirrors what the browser's attribute parser (and .dataset) does when reading the page back.
function extractAttr(html: string, name: string): string {
  const match = html.match(new RegExp(`data-${name}="([^"]*)"`));
  if (!match) throw new Error(`data-${name} not found in generated HTML`);
  return match[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
}

describe('buildLoginPage — XSS escaping', () => {
  const XSS_BREAKOUT = '"><script>alert(document.cookie)</script>';
  const nonce = 'test-nonce';

  it('escapes a redirectUri containing an attribute breakout attempt', () => {
    const html = buildLoginPage({ redirectUri: `https://evil.example.com/${XSS_BREAKOUT}`, codeChallenge: 'chall', nonce });
    expect(html.split('<script')).toHaveLength(2); // only the page's own single <script> block
    expect(extractAttr(html, 'redirect-uri')).toBe(`https://evil.example.com/${XSS_BREAKOUT}`);
  });

  it('escapes a codeChallenge containing an attribute breakout attempt (unvalidated by the route)', () => {
    const html = buildLoginPage({ redirectUri: 'https://claude.ai/callback', codeChallenge: XSS_BREAKOUT, nonce });
    expect(html.split('<script')).toHaveLength(2);
    expect(extractAttr(html, 'code-challenge')).toBe(XSS_BREAKOUT);
  });

  it('escapes a state value containing an attribute breakout attempt (unvalidated by the route)', () => {
    const html = buildLoginPage({ redirectUri: 'https://claude.ai/callback', codeChallenge: 'chall', state: XSS_BREAKOUT, nonce });
    expect(html.split('<script')).toHaveLength(2);
    expect(extractAttr(html, 'state')).toBe(XSS_BREAKOUT);
  });

  it('defaults state to an empty string when omitted', () => {
    const html = buildLoginPage({ redirectUri: 'https://claude.ai/callback', codeChallenge: 'chall', nonce });
    expect(html).toContain('data-state=""');
  });

  it('does not embed clientId anywhere (unused by the page)', () => {
    const html = buildLoginPage({
      redirectUri: 'https://claude.ai/callback',
      codeChallenge: 'chall',
      clientId: '<script>alert(1)</script>',
      nonce,
    });
    expect(html.split('<script')).toHaveLength(2);
  });

  it('carries the given nonce on the inline <script> tag and never interpolates untrusted data into it', () => {
    const html = buildLoginPage({ redirectUri: 'https://claude.ai/callback', codeChallenge: XSS_BREAKOUT, state: XSS_BREAKOUT, nonce });
    expect(html).toContain(`<script nonce="${nonce}">`);
  });
});
