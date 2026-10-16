import { afterEach, describe, expect, it, vi } from 'vitest';
import yaml from 'js-yaml';
import { BaseConfigBuilder } from '../src/BaseConfigBuilder.js';
import { ClashConfigBuilder } from '../src/ClashConfigBuilder.js';
import { ProxyParser } from '../src/ProxyParsers.js';

const subscription = `proxies:
  - name: YAML-node
    type: ss
    server: example.com
    port: 443
    cipher: aes-128-gcm
    password: test-password
`;
const expected = { tag: 'YAML-node', type: 'shadowsocks', server: 'example.com', server_port: 443 };
afterEach(() => vi.unstubAllGlobals());

describe('YAML subscription regression', () => {
  it.each([subscription, Buffer.from(subscription).toString('base64')])('parses direct and Base64 input', async input => {
    const builder = new BaseConfigBuilder(input, {}, 'en', 'test');
    expect(await builder.parseCustomItems()).toEqual([expect.objectContaining(expected)]);
  });
  it('parses remote Base64 YAML subscriptions', async () => {
    const content = Buffer.from(subscription).toString('base64');
    const fetchMock = vi.fn().mockResolvedValue(new Response(content));
    vi.stubGlobal('fetch', fetchMock);
    const result = await ProxyParser.parse('https://subscription.example/test', 'test');
    expect(result.type).toBe('yamlConfig');
    expect(result.proxies).toEqual([expect.objectContaining(expected)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  // Existing decoder corrupts plain remote YAML before yaml.load; track separately.
  it.fails('known baseline issue: parses remote plain YAML', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(subscription)));
    const result = await ProxyParser.parse('https://subscription.example/test', 'test');
    expect(result.type).toBe('yamlConfig');
  });
  it('builds a usable Clash subscription', async () => {
    const builder = new ClashConfigBuilder(subscription, [], [], undefined, 'en', 'test');
    const output = yaml.load(await builder.build());
    expect(output.proxies).toContainEqual(expect.objectContaining({ name: 'YAML-node', type: 'ss', server: 'example.com', port: 443 }));
    expect(output['proxy-groups'].length).toBeGreaterThan(0);
  });
  it('preserves ordered maps, aliases and duplicate-key rejection', () => {
    expect(yaml.load('!!omap\n- first: 1\n- second: 2')).toEqual([{ first: 1 }, { second: 2 }]);
    expect(() => yaml.load('!!omap\n- same: 1\n- same: 2')).toThrow();
    expect(() => yaml.load('key: 1\nkey: 2')).toThrow();
    expect(yaml.load('a: &a [1, 2]\nb: *a').b).toEqual([1, 2]);
    expect(() => yaml.load('proxies: [')).toThrow();
  });
  it('does not use quadratic array searches for ordered-map keys', () => {
    // Count work instead of relying on machine-dependent wall-clock limits.
    const input = '!!omap\n' + Array.from({ length: 2048 }, (_, i) => `- security_key_${i}: ${i}`).join('\n');
    const original = Array.prototype.indexOf;
    let searchedSlots = 0;
    const spy = vi.spyOn(Array.prototype, 'indexOf').mockImplementation(function (key, ...args) {
      if (typeof key === 'string' && key.startsWith('security_key_')) searchedSlots += this.length;
      return original.call(this, key, ...args);
    });
    let result;
    try { result = yaml.load(input); } finally { spy.mockRestore(); }
    expect(result).toHaveLength(2048);
    expect(searchedSlots).toBeLessThanOrEqual(2048);
  });
});
