import type { Hyperspan as HS } from './types';

const REGEXP_PAIR_SPLIT = /; */;

/**
 * RegExp to match field-content in RFC 7230 sec 3.2
 *
 * field-content = field-vchar [ 1*( SP / HTAB ) field-vchar ]
 * field-vchar   = VCHAR / obs-text
 * obs-text      = %x80-FF
 */

const REGEXP_FIELD_CONTENT = /^[\u0009\u0020-\u007e\u0080-\u00ff]+$/;

/**
 * Cookie parsing and serialization
 */
export class Cookies implements HS.Cookies {
  _req: Request;
  _responseHeaders: HS.Cookies['_responseHeaders'];
  _parsedCookies: HS.Cookies['_parsedCookies'] = {};
  _encrypt: HS.Cookies['_encrypt'];
  _decrypt: HS.Cookies['_decrypt'];
  constructor(req: Request, responseHeaders: HS.Cookies['_responseHeaders'] = undefined) {
    this._req = req;
    this._responseHeaders = responseHeaders;
    this._parsedCookies = parse(req.headers.get('Cookie') || '');
  }

  get(name: string): string | undefined {
    const value = this._parsedCookies[name];
    if (value && this._decrypt) {
      return this._decrypt(value);
    }
    return value;
  }

  set(name: string, value: string, options?: HS.CookieOptions) {
    if (!this._responseHeaders) {
      throw new Error('Set cookies in the response object. Cookies can only be read from the request object.');
    }
    if (this._encrypt) {
      value = this._encrypt(value);
    }
    this._responseHeaders.append('Set-Cookie', serialize(name, value, options));
  }

  delete(name: string) {
    this.set(name, '', { expires: new Date(0) });
  }

  /**
   * Set the encoder and decoder functions for the cookies and re-parse the cookie header
   */
  setEncryption(encrypt: HS.Cookies['_encrypt'], decrypt: HS.Cookies['_decrypt']) {
    this._encrypt = encrypt;
    this._decrypt = decrypt;
    this._parsedCookies = parse(this._req.headers.get('Cookie') || '');
  }
}

/*!
 * cookie
 * @source https://github.com/jkohrman/cookie-parse/blob/master/index.js
 * Copyright(c) 2012-2014 Roman Shtylman
 * Copyright(c) 2015 Douglas Christopher Wilson
 * Copyright(c) 2016 Jeff Kohrman
 * MIT Licensed
 */

/**
 * Parse a cookie header.
 *
 * Parse the given cookie header string into an object
 * The object has the various cookies as keys(names) => values
 *
 * @param {string} str
 * @param {object} [options]
 * @return {object}
 * @public
 */

function parse(str: string): Record<string, string | any | undefined> {
  if (typeof str !== 'string') {
    throw new TypeError('argument str must be a string');
  }

  const obj = {}
  const pairs = str.split(REGEXP_PAIR_SPLIT);

  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    let eq_idx = pair.indexOf('=');

    // set true for things that don't look like key=value
    let key;
    let val;
    if (eq_idx < 0) {
      key = pair.trim();
      val = 'true';
    } else {
      key = pair.substring(0, eq_idx).trim()
      val = pair.substring(eq_idx + 1, eq_idx + 1 + pair.length).trim();
    };

    // quoted values
    if ('"' == val[0]) {
      val = val.slice(1, -1);
    }

    // only assign once
    // @ts-ignore
    if (undefined == obj[key]) {
      // @ts-ignore
      obj[key] = tryDecode(val, decodeURIComponent);
    }
  }

  return obj;
}

/**
 * Serialize data into a cookie header.
 *
 * Serialize the a name value pair into a cookie string suitable for
 * http headers. An optional options object specified cookie parameters.
 *
 * serialize('foo', 'bar', { httpOnly: true })
 *   => "foo=bar; httpOnly"
 *
 * @param {string} name
 * @param {string} val
 * @param {object} [options]
 * @return {string}
 * @public
 */
type SerializeOptions = {
  encrypt?: (str: string) => string;
  maxAge?: number;
  domain?: string;
  path?: string;
  expires?: Date;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'lax' | 'strict' | true;
};
function serialize(name: string, val: string, options: SerializeOptions = {}) {
  const opt = options || {};

  if (!REGEXP_FIELD_CONTENT.test(name)) {
    throw new TypeError('argument name is invalid');
  }

  let value = encodeURIComponent(val);

  if (value && !REGEXP_FIELD_CONTENT.test(value)) {
    throw new TypeError('argument val is invalid');
  }

  let str = name + '=' + value;

  if (null != opt.maxAge) {
    const maxAge = opt.maxAge - 0;
    if (isNaN(maxAge)) throw new Error('maxAge should be a Number');
    str += '; Max-Age=' + Math.floor(maxAge);
  }

  if (opt.domain) {
    if (!REGEXP_FIELD_CONTENT.test(opt.domain)) {
      throw new TypeError('option domain is invalid');
    }

    str += '; Domain=' + opt.domain;
  }

  if (opt.path) {
    if (!REGEXP_FIELD_CONTENT.test(opt.path)) {
      throw new TypeError('option path is invalid');
    }

    str += '; Path=' + opt.path;
  }

  if (opt.expires) {
    if (typeof opt.expires.toUTCString !== 'function') {
      throw new TypeError('option expires must be a Date object');
    }

    str += '; Expires=' + opt.expires.toUTCString();
  }

  if (opt.httpOnly) {
    str += '; HttpOnly';
  }

  if (opt.secure) {
    str += '; Secure';
  }

  if (opt.sameSite) {
    const sameSite = typeof opt.sameSite === 'string'
      ? opt.sameSite.toLowerCase() : opt.sameSite;

    switch (sameSite) {
      case true:
      case 'strict':
        str += '; SameSite=Strict';
        break;
      case 'lax':
        str += '; SameSite=Lax';
        break;
      default:
        throw new TypeError('option sameSite is invalid');
    }
  }

  return str;
}

/**
 * Try decoding a string using a decoding function.
 *
 * @param {string} str
 * @param {function} decode
 * @private
 */

function tryDecode(str: string, decode: (str: string) => string) {
  try {
    return decode(str);
  } catch (e) {
    return str;
  }
}