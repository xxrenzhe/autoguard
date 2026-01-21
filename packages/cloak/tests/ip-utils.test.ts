import { describe, expect, it } from 'vitest';
import { isValidCIDR, isValidIP, ipInCIDR } from '@autoguard/shared';

describe('shared ip utils', () => {
  it('validates IPv4/IPv6 CIDR', () => {
    expect(isValidCIDR('192.168.0.0/24')).toBe(true);
    expect(isValidCIDR('2001:db8::/32')).toBe(true);

    expect(isValidCIDR('2001:db8::/129')).toBe(false);
    expect(isValidCIDR('2001:db8::/64abc')).toBe(false);
  });

  it('validates IPv4/IPv6 IP', () => {
    expect(isValidIP('127.0.0.1')).toBe(true);
    expect(isValidIP('2001:db8::1')).toBe(true);

    expect(isValidIP('256.0.0.1')).toBe(false);
    expect(isValidIP('not-an-ip')).toBe(false);
  });

  it('matches IPv4 and IPv6 against CIDR', () => {
    expect(ipInCIDR('192.168.0.5', '192.168.0.0/24')).toBe(true);
    expect(ipInCIDR('10.0.0.1', '192.168.0.0/24')).toBe(false);

    expect(ipInCIDR('2001:db8::1', '2001:db8::/32')).toBe(true);
    expect(ipInCIDR('2001:db9::1', '2001:db8::/32')).toBe(false);

    expect(ipInCIDR('192.168.0.1', '2001:db8::/32')).toBe(false);
  });

  it('supports IPv4-mapped IPv6 in CIDR matching', () => {
    expect(ipInCIDR('::ffff:192.168.0.1', '::ffff:192.168.0.0/120')).toBe(true);
    expect(ipInCIDR('::ffff:192.168.1.1', '::ffff:192.168.0.0/120')).toBe(false);
  });
});

