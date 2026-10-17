// SPDX-License-Identifier: Apache-2.0
/** Builds signed SAML responses like an identity provider would (tests only). */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SignedXml } from 'xml-crypto';

export interface KeyPair {
  privateKey: string;
  certificate: string;
}

/** A throwaway RSA key with a self-signed certificate (needs the openssl command). */
export function newKeyPair(cn = 'test-idp'): KeyPair {
  const dir = mkdtempSync(join(tmpdir(), 'cc-saml-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-days',
        '2',
        '-subj',
        `/CN=${cn}`,
        '-keyout',
        join(dir, 'k.pem'),
        '-out',
        join(dir, 'c.pem'),
      ],
      { stdio: 'ignore' },
    );
    return {
      privateKey: readFileSync(join(dir, 'k.pem'), 'utf8'),
      certificate: readFileSync(join(dir, 'c.pem'), 'utf8'),
    };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export interface AssertionOptions {
  idpEntityId: string;
  audience: string;
  destination: string;
  nameId: string;
  attributes?: Record<string, string>;
  /** Seconds relative to now. */
  notBefore?: number;
  notOnOrAfter?: number;
  sign?: boolean;
  signWith?: KeyPair;
  /** Applied after signing, to simulate tampering. */
  tamper?: (xml: string) => string;
}

const escape = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
const iso = (offsetSeconds: number) => new Date(Date.now() + offsetSeconds * 1000).toISOString();

export function samlResponse(keys: KeyPair, o: AssertionOptions): string {
  const id = `_${randomBytes(12).toString('hex')}`;
  const attributes = Object.entries(o.attributes ?? {})
    .map(
      ([name, value]) =>
        `<saml:Attribute Name="${escape(name)}"><saml:AttributeValue>${escape(value)}</saml:AttributeValue></saml:Attribute>`,
    )
    .join('');
  const assertion =
    `<saml:Assertion xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}a" Version="2.0" IssueInstant="${iso(0)}">` +
    `<saml:Issuer>${escape(o.idpEntityId)}</saml:Issuer>` +
    `<saml:Subject><saml:NameID Format="urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified">${escape(o.nameId)}</saml:NameID>` +
    `<saml:SubjectConfirmation Method="urn:oasis:names:tc:SAML:2.0:cm:bearer"><saml:SubjectConfirmationData NotOnOrAfter="${iso(o.notOnOrAfter ?? 300)}" Recipient="${escape(o.destination)}"/></saml:SubjectConfirmation></saml:Subject>` +
    `<saml:Conditions NotBefore="${iso(o.notBefore ?? -60)}" NotOnOrAfter="${iso(o.notOnOrAfter ?? 300)}"><saml:AudienceRestriction><saml:Audience>${escape(o.audience)}</saml:Audience></saml:AudienceRestriction></saml:Conditions>` +
    `<saml:AuthnStatement AuthnInstant="${iso(-5)}"><saml:AuthnContext><saml:AuthnContextClassRef>urn:oasis:names:tc:SAML:2.0:ac:classes:Password</saml:AuthnContextClassRef></saml:AuthnContext></saml:AuthnStatement>` +
    (attributes ? `<saml:AttributeStatement>${attributes}</saml:AttributeStatement>` : '') +
    `</saml:Assertion>`;
  let xml =
    `<samlp:Response xmlns:samlp="urn:oasis:names:tc:SAML:2.0:protocol" xmlns:saml="urn:oasis:names:tc:SAML:2.0:assertion" ID="${id}" Version="2.0" IssueInstant="${iso(0)}" Destination="${escape(o.destination)}">` +
    `<saml:Issuer>${escape(o.idpEntityId)}</saml:Issuer>` +
    `<samlp:Status><samlp:StatusCode Value="urn:oasis:names:tc:SAML:2.0:status:Success"/></samlp:Status>${assertion}</samlp:Response>`;
  if (o.sign !== false) {
    const signer = o.signWith ?? keys;
    const sig = new SignedXml({
      privateKey: signer.privateKey,
      publicCert: signer.certificate,
      signatureAlgorithm: 'http://www.w3.org/2001/04/xmldsig-more#rsa-sha256',
      canonicalizationAlgorithm: 'http://www.w3.org/2001/10/xml-exc-c14n#',
    });
    sig.addReference({
      xpath: "//*[local-name(.)='Assertion']",
      digestAlgorithm: 'http://www.w3.org/2001/04/xmlenc#sha256',
      transforms: [
        'http://www.w3.org/2000/09/xmldsig#enveloped-signature',
        'http://www.w3.org/2001/10/xml-exc-c14n#',
      ],
    });
    sig.computeSignature(xml, {
      location: { reference: "//*[local-name(.)='Assertion']/*[local-name(.)='Issuer']", action: 'after' },
    });
    xml = sig.getSignedXml();
  }
  return Buffer.from(o.tamper ? o.tamper(xml) : xml, 'utf8').toString('base64');
}
