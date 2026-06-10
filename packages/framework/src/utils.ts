import { createHash, randomBytes } from "node:crypto";

export function assetHash(content: string): string {
  return createHash('md5').update(content).digest('hex');
}

export function randomHash(): string {
  return createHash('md5').update(randomBytes(32).toString('hex')).digest('hex');
}


/**
 * Normalize URL path
 * Removes trailing slash and lowercases path
 */
const ROUTE_SEGMENT_REGEX = /(\[[a-zA-Z_\.]+\])/g;
export function parsePath(urlPath: string): { path: string, params: string[] } {
  const params: string[] = [];
  urlPath = urlPath.replace('index', '').replace('.ts', '').replace('.js', '');

  if (urlPath.startsWith('/')) {
    urlPath = urlPath.substring(1);
  }

  if (urlPath.endsWith('/')) {
    urlPath = urlPath.substring(0, urlPath.length - 1);
  }

  if (!urlPath) {
    return { path: '/', params: [] };
  }

  // Dynamic params
  if (ROUTE_SEGMENT_REGEX.test(urlPath)) {
    urlPath = urlPath.replace(ROUTE_SEGMENT_REGEX, (match: string) => {
      const paramName = match.replace(/[^a-zA-Z_\.]+/g, '');
      params.push(paramName);

      if (match.includes('...')) {
        return '*';
      } else {
        return ':' + paramName;
      }
    });
  }

  // Only lowercase non-param segments (do not lowercase after ':')
  return {
    path: (
      '/' +
      urlPath
        .split('/')
        .map((segment) =>
          segment.startsWith(':') || segment === '*' ? segment : segment.toLowerCase()
        )
        .join('/')
    ),
    params,
  };
}

/**
 * Is valid route path to add to server?
 */
export function isValidRoutePath(path: string): boolean {
  const isHiddenRoute = path.includes('/__');
  const isTestFile = path.includes('.test') || path.includes('.spec');

  return !isHiddenRoute && !isTestFile && Boolean(path);
}

/**
 * Return JSON data structure for a given FormData or URLSearchParams object
 * Accounts for array fields (e.g. name="options[]" or <select multiple>)
 *
 * @link https://stackoverflow.com/a/75406413
 */
export function formDataToJSON(formData: FormData | URLSearchParams): Record<string, string | string[]> {
  let object = {};

  /**
   * Parses FormData key xxx`[x][x][x]` fields into array
   */
  const parseKey = (key: string) => {
    const subKeyIdx = key.indexOf('[');

    if (subKeyIdx !== -1) {
      const keys = [key.substring(0, subKeyIdx)];
      key = key.substring(subKeyIdx);

      for (const match of key.matchAll(/\[(?<key>.*?)]/gm)) {
        if (match.groups) {
          keys.push(match.groups.key);
        }
      }
      return keys;
    } else {
      return [key];
    }
  };

  /**
   * Recursively iterates over keys and assigns key/values to object
   */
  const assign = (keys: string[], value: FormDataEntryValue, object: any): void => {
    const key = keys.shift();

    // When last key in the iterations
    if (key === '' || key === undefined) {
      return object.push(value);
    }

    if (Reflect.has(object, key)) {
      // If key has been found, but final pass - convert the value to array
      if (keys.length === 0) {
        if (!Array.isArray(object[key])) {
          object[key] = [object[key], value];
          return;
        }
      }
      // Recurse again with found object
      return assign(keys, value, object[key]);
    }

    // Create empty object for key, if next key is '' do array instead, otherwise set value
    if (keys.length >= 1) {
      object[key] = keys[0] === '' ? [] : {};
      return assign(keys, value, object[key]);
    } else {
      object[key] = value;
    }
  };

  /**
   * Recursively converts objects whose keys are ALL numeric (e.g. "contact[0][name]",
   * "contact[1][name]") into arrays of objects. Objects with any non-numeric key are
   * left as-is.
   */
  const arrayify = (value: any): any => {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
      return value;
    }

    const keys = Object.keys(value);
    const allNumeric = keys.length > 0 && keys.every((key) => /^\d+$/.test(key));

    if (allNumeric) {
      const array: any[] = [];
      for (const key of keys.sort((a, b) => Number(a) - Number(b))) {
        array[Number(key)] = arrayify(value[key]);
      }
      return array;
    }

    for (const key of keys) {
      value[key] = arrayify(value[key]);
    }
    return value;
  };

  for (const pair of formData.entries()) {
    assign(parseKey(pair[0]), pair[1], object);
  }

  return arrayify(object);
}

/**
 * Remove undefined values from an object
 */
export function removeUndefined(obj: Record<string, any>): Record<string, any> {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}