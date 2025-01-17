const timers = require("node:timers/promises");
const nodeUtil = require("util");
const Sentry = require("@sentry/node");
const got = require("got");
const config = require("./config");
const { ParseError } = require("./exceptions");
const { VaccineProduct } = require("./model");

const MULTIPLE_SPACE_PATTERN = /[\n\s]+/g;
const PUNCTUATION_PATTERN = /[.,;\-–—'"“”‘’`!()/\\]+/g;
const POSSESSIVE_PATTERN = /['’]s /g;
const ADDRESS_LINE_DELIMITER_PATTERN = /,|\n|\s-\s/g;

const ADDRESS_PATTERN =
  /^(.*),\s+([^,]+),\s+([A-Z]{2}),?\s+(\d+(-\d{4})?)\s*$/i;

// Common abbreviations in addresses and their expanded, full English form.
// These are used to match similar addresses. For example:
//   "600 Ocean Hwy" and "600 Ocean Highway"
// They're always used in lower-case text where punctuation has been removed.
// In some cases, the replacements *remove* the abbreviation entirely to enable
// better loose matching (usually for road types, like "road" vs. "street").
const ADDRESS_EXPANSIONS = [
  [/ i /g, " interstate "],
  [/ i-(\d+) /g, " interstate $1 "],
  [/ expy /g, " expressway "],
  [/ fwy /g, " freeway "],
  [/ hwy /g, " highway "],
  [/ (u s|us) /g, " "], // Frequently in "U.S. Highway / US Highway"
  [/ (s r|sr|st rt|state route|state road) /g, " route "],
  [/ rt /g, " route "],
  [/ (tpke?|pike) /g, " turnpike "],
  [/ ft /g, " fort "],
  [/ mt /g, " mount "],
  [/ mtn /g, " mountain "],
  [/ (is|isl|island) /g, " "],
  [/ n\s?w /g, " northwest "],
  [/ s\s?w /g, " southwest "],
  [/ n\s?e /g, " northeast "],
  [/ s\s?e /g, " southeast "],
  [/ n /g, " north "],
  [/ s /g, " south "],
  [/ e /g, " east "],
  [/ w /g, " west "],
  [/ ave? /g, " "],
  [/ avenue? /g, " "],
  [/ dr /g, " "],
  [/ drive /g, " "],
  [/ rd /g, " "],
  [/ road /g, " "],
  [/ st /g, " "],
  [/ street /g, " "],
  [/ saint /g, " "], // Unfortunately, this gets mixed in with st for street.
  [/ blvd /g, " "],
  [/ boulevard /g, " "],
  [/ ln /g, " "],
  [/ lane /g, " "],
  [/ cir /g, " "],
  [/ circle /g, " "],
  [/ ct /g, " "],
  [/ court /g, " "],
  [/ cor /g, " "],
  [/ corner /g, " "],
  [/ (cmn|common|commons) /g, " "],
  [/ ctr /g, " "],
  [/ center /g, " "],
  [/ pl /g, " "],
  [/ place /g, " "],
  [/ plz /g, " "],
  [/ plaza /g, " "],
  [/ pkw?y /g, " "],
  [/ parkway /g, " "],
  [/ cswy /g, " "],
  [/ causeway /g, " "],
  [/ byp /g, " "],
  [/ bypass /g, " "],
  [/ mall /g, " "],
  [/ (xing|crssng) /g, " "],
  [/ crossing /g, " "],
  [/ sq /g, " "],
  [/ square /g, " "],
  [/ trl? /g, " "],
  [/ trail /g, " "],
  [/ (twp|twsp|townsh(ip)?) /g, " "],
  [/ est(ate)? /g, " estates "],
  [/ vlg /g, " "],
  [/ village /g, " "],
  [/ (ste|suite|unit|apt|apartment) #?(\d+) /g, " $2 "],
  [/ (bld|bldg) #?(\d+) /g, " $2 "],
  [/ #?(\d+) /g, " $1 "],
  [/ (&|and) /g, " "],
  // "First" - "Tenth" are pretty common (this could obviously go farther).
  [/ first /g, " 1st "],
  [/ second /g, " 2nd "],
  [/ third /g, " 3rd "],
  [/ fourth /g, " 4th "],
  [/ fifth /g, " 5th "],
  [/ sixth /g, " 6th "],
  [/ seventh /g, " 7th "],
  [/ eighth /g, " 8th "],
  [/ ninth /g, " 9th "],
  [/ tenth /g, " 10th "],
];

const USER_AGENTS = [
  "Mozilla/5.0 CK={} (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko 	Internet Explorer 11 	Web Browser 	Computer 	Very common",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.169 Safari/537.36 	Chrome 74 	Web Browser 	Computer 	Very common",
  "Mozilla/5.0 (Windows NT 10.0; WOW64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/72.0.3626.121 Safari/537.36 	Chrome 72 	Web Browser 	Computer 	Very common",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/74.0.3729.157 Safari/537.36 	Chrome 74 	Web Browser 	Computer 	Very common",
  "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1; .NET CLR 1.1.4322) 	Internet Explorer 6 	Web Browser 	Computer 	Very common",
  "Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1) 	Internet Explorer 6 	Web Browser 	Computer 	Very common",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/60.0.3112.113 Safari/537.36 	Chrome 60 	Web Browser 	Computer 	Very common",
  "Mozilla/5.0 (Windows NT 6.1; WOW64; Trident/7.0; rv:11.0) like Gecko 	Internet Explorer 11 	Web Browser 	Computer 	Very common",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/64.0.3282.140 Safari/537.36 Edge/17.17134",
];

// US standard/daylight time zone names mapped to ISO 8601-style offset strings.
const TIME_ZONE_OFFSET_STRINGS = {
  AKDT: "-08:00",
  AKST: "-09:00",
  CDT: "-05:00",
  CST: "-06:00",
  EDT: "-04:00",
  EST: "-05:00",
  HDT: "-09:00",
  HST: "-10:00",
  MDT: "-06:00",
  MST: "-07:00",
  PDT: "-07:00",
  PST: "-08:00",
};

const r = String.raw;

// Possible separators between digits in a phone number.
const PHONE_SEPARATOR = r`[\s.-]`;
// Pattern for matching US-style phone numbers with area codes.
// prettier-ignore
const PHONE_NUMBER_PATTERN = new RegExp(
  r`^`                           +
  r`(?:\+?1${PHONE_SEPARATOR})?` + // May start with a country code
  r`(\([2-9]\d\d\)|[2-9]\d\d)`   + // Area code, possibly in parentheses
  PHONE_SEPARATOR                +
  r`([2-9]\d\d)`                 + // Central Office number
  PHONE_SEPARATOR                +
  r`(\d{1,4})`                   + // Local number
  r`$`
);

const DEFAULT_STATES = [
  "AL",
  "AK",
  "AZ",
  "AR",
  "CA",
  "CO",
  "CT",
  "DE",
  "DC",
  "FL",
  "GA",
  "HI",
  "ID",
  "IL",
  "IN",
  "IA",
  "KS",
  "KY",
  "LA",
  "ME",
  "MD",
  "MA",
  "MI",
  "MN",
  "MS",
  "MO",
  "MT",
  "NE",
  "NV",
  "NH",
  "NJ",
  "NM",
  "NY",
  "NC",
  "ND",
  "OH",
  "OK",
  "OR",
  "PA",
  "RI",
  "SC",
  "SD",
  "TN",
  "TX",
  "UT",
  "VT",
  "VA",
  "WA",
  "WV",
  "WI",
  "WY",
  "MH",
  "PR",
  "VI",
];

/**
 * Enforce rate limits on operations by awaiting the `ready()` method on
 * instances of this class.
 *
 * @example
 * // Log every two seconds (10 times).
 * const rateLimit = new RateLimit(0.5);
 * for (let i = 0; i < 10; i++) {
 *   await rateLimit.ready();
 *   console.log(new Date);
 * }
 */
class RateLimit {
  /**
   * Create a new instance of `RateLimit` with a given rate.
   * @param {number} callsPerSecond Maximum number of times per second that
   *        the `ready()` method will resolve.
   */
  constructor(callsPerSecond) {
    this.interval = callsPerSecond > 0 ? 1000 / callsPerSecond : 0;
    this._waiting = null;
    this._lastUsed = 0;
  }

  async ready() {
    // If something else is already waiting, wait with it.
    while (this._waiting) {
      await this._waiting;
    }

    // If it hasn't been long enough since the last call, wait.
    const minimumWait = this.interval - (Date.now() - this._lastUsed);
    if (minimumWait > 0) {
      let release;
      this._waiting = new Promise((r) => (release = r));

      await timers.setTimeout(minimumWait);

      // Schedule `_waiting` to release in the next microtask.
      Promise.resolve().then(() => {
        this._waiting = null;
        release();
      });
    }

    this._lastUsed = Date.now();
    return;
  }
}

module.exports = {
  DEFAULT_STATES,

  USER_AGENTS,

  TIME_ZONE_OFFSET_STRINGS,

  RateLimit,

  /**
   * Simplify a text string (especially an address) as much as possible so that
   * it might match with a similar string from another source.
   * @param {string} text
   * @returns {string}
   */
  matchable(text) {
    return text
      .toLowerCase()
      .replace(POSSESSIVE_PATTERN, " ")
      .replace(PUNCTUATION_PATTERN, " ")
      .replace(MULTIPLE_SPACE_PATTERN, " ")
      .trim();
  },

  matchableAddress(text, line = null) {
    let lines = Array.isArray(text)
      ? text
      : text.split(ADDRESS_LINE_DELIMITER_PATTERN);

    // If there are multiple lines and it looks like the first line is the name
    // of a place (rather than the street), drop the first line.
    if (lines.length > 1 && !/\d/.test(lines[0])) {
      lines = lines.slice(1);
    }

    if (line != null) {
      lines = lines.slice(line, line + 1);
    }

    let result = module.exports.matchable(lines.join(" "));
    for (const [pattern, expansion] of ADDRESS_EXPANSIONS) {
      result = result.replace(pattern, expansion);
    }

    return result;
  },

  /**
   * Parse a US-style address string.
   * @param {string} address
   * @returns {{lines: Array<string>, city: string, state: string, zip: string}}
   */
  parseUsAddress(address) {
    const match = address.match(ADDRESS_PATTERN);

    // Detect whether we have something formatted like an address, but with
    // obviously incorrect street/city/zip data, e.g. "., ., CA 90210".
    const invalidMatch =
      !match ||
      match[1].replace(PUNCTUATION_PATTERN, "") === "" ||
      match[2].replace(PUNCTUATION_PATTERN, "") === "" ||
      match[4].replace(PUNCTUATION_PATTERN, "") === "";
    if (invalidMatch) {
      throw new ParseError(`Could not parse address: "${address}"`);
    }

    let zip = match[4];
    if (zip.split("-")[0].length < 5) {
      warn(`Invalid ZIP code in address: "${address}"`);
      zip = undefined;
    }

    return {
      lines: [match[1]],
      city: match[2],
      state: match[3].toUpperCase(),
      zip,
    };
  },

  /**
   * Parse and return a US-style phone number with an area code and, optionally,
   * a country code. This handles some oddball situations like phone numbers
   * where each component is a number and is missing leading zeroes.
   *
   * Returns a string in the format "(nnn) nnn-nnnn". Will throw `ParseError`
   * if `text` cannot be parsed.
   * @param {string} text The phone number to parse.
   * @returns {string}
   */
  parseUsPhoneNumber(text) {
    const match = text.trim().match(PHONE_NUMBER_PATTERN);
    if (match) {
      const parts = [
        match[1].replace("(", "").replace(")", "").padStart(3, "0"),
        match[2].padStart(3, "0"),
        match[3].padStart(4, "0"),
      ];
      return `(${parts[0]}) ${parts[1]}-${parts[2]}`;
    }

    throw new ParseError(`Invalid U.S. phone number: "${text}"`);
  },

  /**
   * Template string tag that transforms a template string into a single line.
   * Line breaks and indentations are reduced to a single space character.
   * @param {TemplateStringsArray} strings String components of the template literal.
   * @param  {...any} replacements Interpolated replacements in the template.
   * @returns {string}
   *
   * @example
   * oneLine`This
   *   text is
   *   on multiple lines but
   *        it'll be reduced to
   * just one.
   * ` === `This text is on multiple lines but it'll be reduced to just one.`
   */
  oneLine(strings, ...replacements) {
    const removablePattern = /\n\s*/g;
    const length = replacements.length;
    return strings
      .map((text, index) => {
        let unbroken = text.replace(removablePattern, " ");
        unbroken += length > index ? String(replacements[index]) : "";
        return unbroken;
      })
      .join("")
      .trim();
  },

  /**
   * Remove an item matching a predicate function from an array and return it.
   * @param {Array} list Array to remove the item from.
   * @param {(any) => boolean} predicate Function to identify an item to remove
   */
  popItem(list, predicate) {
    const index = list.findIndex(predicate);
    return index > -1 ? list.splice(index, 1)[0] : undefined;
  },

  /**
   * Capitalize the first letter of each word in a string.
   * @param {string} text
   * @returns {string}
   */
  titleCase(text) {
    return text
      .split(" ")
      .map(
        (chunk) => chunk.charAt(0).toUpperCase() + chunk.slice(1).toLowerCase()
      )
      .join(" ");
  },

  createWarningLogger(prefix, level = "info") {
    return function warn(message, context, sendContextToSentry = false) {
      const logMessage = prefix ? `${prefix}: ${message}` : message;
      console.warn(
        logMessage,
        context !== undefined ? nodeUtil.inspect(context, { depth: 8 }) : ""
      );

      const sentryInfo = { level };
      if (context && sendContextToSentry) {
        sentryInfo.contexts = { context };
      }

      // Sentry does better fingerprinting with an actual exception object.
      if (message instanceof Error) {
        Sentry.captureException(message, sentryInfo);
      } else {
        Sentry.captureMessage(logMessage, sentryInfo);
      }
    };
  },

  /**
   * Get a random integer between a `low` value (inclusive) and a `high` value
   * (exclusive).
   * @param {number} low Lowest possible value
   * @param {number} high Highest possible value
   * @returns number
   */
  randomInt(low, high) {
    return Math.floor(Math.random() * (high - low) + low);
  },

  /**
   * Get a random User-Agent string.
   *
   * Some sites use User-Agent (in combination with other things like IP
   * address or cookies) to detect bots or single clients that are making lots
   * of requests (like us!) and ban them. Switching user agents on each request
   * or every few requests can help reduce the likelihood of getting blocked.
   *
   * (Often we need to use additional measures, too, like running from multiple
   * IPs or using proxies.)
   * @returns string
   */
  randomUserAgent() {
    return USER_AGENTS[module.exports.randomInt(0, USER_AGENTS.length)];
  },

  /**
   * Split `text` at most once by `delim`.
   * @param {string} text
   * @param {string} delim
   * @returns {Array<string>}
   */
  splitOnce(text, delim) {
    const i = text.indexOf(delim);
    if (i < 0) {
      return [text];
    } else {
      return [text.substring(0, i), text.substring(i + delim.length)];
    }
  },

  /**
   * A pre-configured Got instance with appropriate headers, etc.
   * @type {import("got").GotRequestFunction}
   */
  httpClient: got.extend({
    headers: { "User-Agent": config.userAgent },
    timeout: 2.5 * 60 * 1000, // 2.5 minutes
  }),

  /**
   * Remove key/value pairs from an object using a filter function. Effectively
   * the same as `Array.filter()`, but for Objects.
   * @param {Object} source Object to filter entries from.
   * @param {([string, any]) => boolean} predicate Filter function. Takes an
   *        an array with an entry key and value as the only argument.
   * @returns {Object}
   */
  filterObject(source, predicate) {
    return Object.fromEntries(Object.entries(source).filter(predicate));
  },

  /**
   * Remove zeros from the leading edge of a numeric string. If the string has
   * non-numeric characters (e.g. `-`), leave it alone.
   * @param {string} numberString
   * @returns {string}
   */
  unpadNumber(numberString) {
    return numberString.replace(/^0+(\d+)$/, "$1");
  },

  /**
   * Remove duplicate entries from a list of external IDs.
   * @param {Array<[string,string]>} idList
   * @returns {Array<[string,string]>}
   */
  getUniqueExternalIds(idList) {
    const seen = new Set();
    const result = [];
    for (const id of idList) {
      const stringId = id.join(":");
      if (!seen.has(stringId)) {
        result.push(id);
        seen.add(stringId);
      }
    }
    return result;
  },

  /**
   * Fuzzily match a vaccine name string to one of our product types. Returns
   * `undefined` if there's no match.
   * @param {string} name
   * @returns {VaccineProduct}
   */
  matchVaccineProduct(name) {
    const text = name.toLowerCase();
    const isBa4Ba5 = /bivalent|omicron|ba\.\s?4|ba\.\s?5/i.test(text);

    if (/astra\s*zeneca/.test(text)) {
      return isBa4Ba5 ? undefined : VaccineProduct.astraZeneca;
    } else if (text.includes("moderna")) {
      if (/ages?\s+(6|12|18)( (years )?and up|\s*\+)/i.test(text)) {
        return isBa4Ba5 ? VaccineProduct.modernaBa4Ba5 : VaccineProduct.moderna;
      } else if (/ages?\s+6\s*(m|months)\b/i.test(text)) {
        return isBa4Ba5 ? undefined : VaccineProduct.modernaAge0_5;
      } else if (/ages? 6\s?(-|through)\s?11/i.test(text)) {
        return isBa4Ba5 ? undefined : VaccineProduct.modernaAge6_11;
      } else if (/ped|child|age/i.test(text)) {
        // Possibly a pediatric variation we haven't seen, so return nothing to
        // trigger warnings so we can address it.
        return undefined;
      } else {
        return isBa4Ba5 ? VaccineProduct.modernaBa4Ba5 : VaccineProduct.moderna;
      }
    } else if (/nova\s*vax/.test(text)) {
      return isBa4Ba5 ? undefined : VaccineProduct.novavax;
    } else if (text.includes("comirnaty") || text.includes("pfizer")) {
      if (/ages?\s+12( (years )?and up|\s*\+)/i.test(text)) {
        return isBa4Ba5 ? VaccineProduct.pfizerBa4Ba5 : VaccineProduct.pfizer;
      } else if (/ages?\s+5|\b5\s?(-|through)\s?11\b/i.test(text)) {
        return isBa4Ba5
          ? VaccineProduct.pfizerBa4Ba5Age5_11
          : VaccineProduct.pfizerAge5_11;
      } else if (/ages?\s+6\s*(m|months)\b/i.test(text)) {
        return isBa4Ba5 ? undefined : VaccineProduct.pfizerAge0_4;
      } else if (/ped|child|age/i.test(text)) {
        // Possibly a pediatric variation we haven't seen, so return nothing to
        // trigger warnings so we can address it.
        return undefined;
      } else {
        return isBa4Ba5 ? VaccineProduct.pfizerBa4Ba5 : VaccineProduct.pfizer;
      }
    } else if (/janssen|johnson/.test(text)) {
      return isBa4Ba5 ? undefined : VaccineProduct.janssen;
    }

    return undefined;
  },

  /**
   * Ensure a string is a complete URL. If it is already a valid URL, the input
   * string is returned as-is. If it's missing a scheme (e.g. "www.kroger.com"),
   * the returned value will have a scheme added. If null, undefined, or an
   * empty string are passed in, `undefined` will be returned.
   *
   * If the input doesn't look like it's really a URL (e.g. "Not a URL!"), this
   * will throw a `ParseError`.
   *
   * This is meant for fairly simple scenarios; more we should use an external
   * dependency if our needs get much more complex.
   * @param {string} text Something that should be a URL.
   * @returns {string|undefined}
   */
  cleanUrl(text) {
    let result = text?.trim();
    if (!result) return undefined;

    const urlPattern = /^(https?:\/\/)?[^/\s]+\.[^/\s]{2,}(?:\/[^\s]*)?$/i;
    const urlParts = result.match(urlPattern);
    if (urlParts) {
      if (!urlParts[1]) {
        result = `http://${result}`;
      }
      return result;
    }

    throw new ParseError(`Text is not a URL: "${text}"`);
  },
};

const warn = module.exports.createWarningLogger("utils");
