const nock = require("nock");
const {
  API_URL,
  checkAvailability,
  formatLocation,
  parseNameAndAddress,
} = require("../src/sources/albertsons");
const { corrections } = require("../src/sources/albertsons/corrections");
const { Available } = require("../src/model");
const { expectDatetimeString, splitHostAndPath } = require("./support");
const { locationSchema } = require("./support/schemas");
const { ParseError } = require("../src/exceptions");

// Mock utils so we can track logs.
jest.mock("../src/utils");

const [API_URL_BASE, API_URL_PATH] = splitHostAndPath(API_URL);

const basicLocation = {
  id: "123456789",
  region: "Eastern_-_6",
  address: "Albertsons 0393 - 7315 Famous Ave., Nowhere, MD, 20912",
  lat: "38.98247194054162",
  long: "-76.9879339600021",
  coach_url: "https://kordinator.mhealthcoach.net/vcl/1637101034326",
  availability: "yes",
  drugName: ["PfizerChild"],
};

describe("Albertsons", () => {
  // Keep a copy of manual corrections so we can reset it if altered in tests.
  const _corrections = { ...corrections };

  afterEach(() => {
    nock.cleanAll();

    for (const key of Object.keys(corrections)) {
      delete corrections[key];
    }
    Object.assign(corrections, _corrections);
  });

  it.nock("should output valid data", { ignoreQuery: ["v"] }, async () => {
    const result = await checkAvailability(() => {}, { states: ["AK"] });
    expect(result).toContainItemsMatchingSchema(locationSchema);
  });

  it("should successfully format results", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(
        200,
        [
          {
            id: "1600116808972",
            region: "Alaska",
            address: "Safeway 3410 - 30 College Rd, Fairbanks, AK, 99701",
            lat: "64.8515679",
            long: "-147.7024008",
            coach_url: "https://kordinator.mhealthcoach.net/vcl/1600116808972",
            availability: "no",
            drugName: ["Moderna"],
          },
          {
            id: "1600114849843",
            region: "Alaska",
            address: "Carrs 1813 - 1501 Huffman Road, Anchorage, AK, 99515",
            lat: "61.1096597",
            long: "-149.8559918",
            coach_url: "https://kordinator.mhealthcoach.net/vcl/1600114849843",
            availability: "yes",
            drugName: ["Pfizer", "Moderna"],
          },
        ],
        { "Last-Modified": "Thu, 28 Oct 2021 07:06:13 GMT" }
      );

    const result = await checkAvailability(() => {}, { states: ["AK"] });
    expect(result).toContainItemsMatchingSchema(locationSchema);
    expect(result).toEqual([
      {
        name: "Safeway Pharmacy #3410",
        external_ids: [
          ["albertsons", "1600116808972"],
          ["albertsons_safeway", "1600116808972"],
          ["safeway", "3410"],
          ["albertsons_store_number", "safeway:3410"],
        ],
        location_type: "PHARMACY",
        provider: "albertsons",
        address_lines: ["30 College Rd"],
        city: "Fairbanks",
        state: "AK",
        postal_code: "99701",
        position: {
          longitude: -147.7005749,
          latitude: 64.8517344,
        },
        info_phone: "(907) 374-4160",
        info_url:
          "https://local.pharmacy.safeway.com/ak/fairbanks/30-college-rd.html",
        booking_url: "https://kordinator.mhealthcoach.net/vcl/1600116808972",
        availability: {
          source: "univaf-albertsons",
          available: "NO",
          products: ["moderna"],
          is_public: true,
          checked_at: expectDatetimeString(),
          valid_at: "2021-10-28T07:06:13.000Z",
        },
        meta: {
          albertsons_region: "Alaska",
          mhealth_address: "Safeway 3410 - 30 College Rd, Fairbanks, AK, 99701",
          timezone: "America/Anchorage",
          booking_url_adult:
            "https://kordinator.mhealthcoach.net/vcl/1600116808972",
          booking_urls: [
            {
              available: "NO",
              products: ["moderna"],
              url: "https://kordinator.mhealthcoach.net/vcl/1600116808972",
            },
          ],
        },
        description:
          "Looking for a pharmacy near you in Fairbanks, AK? Our on-site pharmacy can administer Covid vaccinations, Pfizer, Moderna, and J&J Covid second booster shot and flu shots at no additional cost. Fill, refill or transfer prescriptions with us. We welcome scheduled or walk-in immunizations. Back to school vaccine immunizations and covid-19 PCR NAAT walk in test now available. We are located at 30 College Rd.",
      },
      {
        name: "Carrs Pharmacy #1813",
        external_ids: [
          ["albertsons", "1600114849843"],
          ["albertsons_carrs", "1600114849843"],
          ["carrs", "1813"],
          ["albertsons_store_number", "carrs:1813"],
        ],
        location_type: "PHARMACY",
        provider: "albertsons",
        address_lines: ["1501 Huffman Rd"],
        city: "Anchorage",
        state: "AK",
        postal_code: "99515",
        position: {
          longitude: -149.854128,
          latitude: 61.1096739,
        },
        info_phone: "(907) 339-1360",
        info_url:
          "https://local.pharmacy.carrsqc.com/ak/anchorage/1501-huffman-rd.html",
        booking_url: "https://kordinator.mhealthcoach.net/vcl/1600114849843",
        availability: {
          source: "univaf-albertsons",
          available: "YES",
          products: ["pfizer", "moderna"],
          is_public: true,
          checked_at: expectDatetimeString(),
          valid_at: "2021-10-28T07:06:13.000Z",
        },
        meta: {
          albertsons_region: "Alaska",
          mhealth_address:
            "Carrs 1813 - 1501 Huffman Road, Anchorage, AK, 99515",
          timezone: "America/Anchorage",
          booking_url_adult:
            "https://kordinator.mhealthcoach.net/vcl/1600114849843",
          booking_urls: [
            {
              available: "YES",
              products: ["pfizer", "moderna"],
              url: "https://kordinator.mhealthcoach.net/vcl/1600114849843",
            },
          ],
        },
        description:
          "Looking for a pharmacy near you in Anchorage, AK? Our on-site pharmacy can administer Covid vaccinations, Pfizer, Moderna, and J&J Covid second booster shot and flu shots at no additional cost. Fill, refill or transfer prescriptions with us. We welcome scheduled or walk-in immunizations. Back to school vaccine immunizations and covid-19 PCR NAAT walk in test now available. We are located at 1501 Huffman Rd.",
      },
    ]);
  });

  it("should fix names that repeat after the store number", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(200, [
        {
          ...basicLocation,
          address: "Safeway 3410 Safeway - 30 College Rd, Fairbanks, AK, 99701",
        },
      ]);

    const result = await checkAvailability(() => {}, { states: ["AK"] });
    expect(result[0]).toHaveProperty("name", "Safeway Pharmacy #3410");
    expect(result[0]).toHaveProperty("address_lines", ["30 College Rd"]);
    expect(result).toContainItemsMatchingSchema(locationSchema);
  });

  it("handles unexpected availability strings", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(200, [
        {
          ...basicLocation,
          availability: "whoseywhatsit?",
        },
      ]);

    const result = await checkAvailability(() => {}, { states: ["MD"] });
    expect(result).toContainItemsMatchingSchema(locationSchema);
    expect(result[0]).toHaveProperty(
      "availability.available",
      Available.unknown
    );
  });

  it("handles missing drugName property", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(200, [
        {
          id: "1600116808972",
          region: "Alaska",
          address: "Safeway 3410 - 30 College Rd, Fairbanks, AK, 99701",
          lat: "64.8515679",
          long: "-147.7024008",
          coach_url: "https://kordinator.mhealthcoach.net/vcl/1600116808972",
          availability: "yes",
        },
      ]);

    const result = await checkAvailability(() => {}, { states: ["AK"] });
    expect(result).toContainItemsMatchingSchema(locationSchema);
    expect(result[0].availability.products).toBe(undefined);
  });

  it("skips over unknown drugName values", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(200, [
        {
          ...basicLocation,
          drugName: ["Not A Known Vaccine", "Pfizer"],
        },
      ]);

    const result = await checkAvailability(() => {}, { states: ["MD"] });
    expect(result).toContainItemsMatchingSchema(locationSchema);
    expect(result[0]).toHaveProperty("availability.products", ["pfizer"]);
  });

  it("skips over test locations", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(200, [
        {
          ...basicLocation,
          address: "Public Test  - 1211 Test St, Testville, AK, 99201",
        },
      ]);

    const result = await checkAvailability(() => {}, { states: ["AK"] });
    expect(result).toHaveLength(0);
  });

  it("handles separate adult and pediatric entries for the same location", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(
        200,
        [
          {
            id: "1635993536219",
            region: "Eastern_-_6",
            address:
              "Pfizer Child - Safeway 0005 - 11120 South Lakes Drive, Reston, VA, 20191",
            lat: "38.939784",
            long: "-77.332298",
            coach_url: "https://kordinator.mhealthcoach.net/vcl/1635993536219",
            availability: "yes",
            drugName: ["PfizerChild"],
          },
          {
            id: "1635993536220",
            region: "Eastern_-_6",
            address:
              "Pfizer Infant - Safeway 0005 - 11120 South Lakes Drive, Reston, VA, 20191",
            lat: "38.939784",
            long: "-77.332298",
            coach_url: "https://kordinator.mhealthcoach.net/vcl/1635993536220",
            availability: "yes",
            drugName: ["PfizerToddler"],
          },
          {
            id: "1600100807144",
            region: "Virginia",
            address:
              "Safeway 0005 - 11120 South Lakes Drive, Reston, VA, 20191",
            lat: "38.939784",
            long: "-77.332298",
            coach_url: "https://kordinator.mhealthcoach.net/vcl/1600100807144",
            availability: "yes",
            drugName: ["Pfizer", "Moderna", "JnJ"],
          },
        ],
        { "Last-Modified": "Thu, 28 Oct 2021 07:06:13 GMT" }
      );

    const result = await checkAvailability(() => {}, { states: ["VA"] });
    expect(result).toContainItemsMatchingSchema(locationSchema);
    expect(result).toEqual([
      {
        name: "Safeway Pharmacy #5",
        external_ids: [
          ["albertsons", "1635993536219"],
          ["albertsons_safeway", "1635993536219"],
          ["safeway", "5"],
          ["albertsons_store_number", "safeway:5"],
          ["albertsons", "1635993536220"],
          ["albertsons_safeway", "1635993536220"],
          ["albertsons", "1600100807144"],
          ["albertsons_safeway", "1600100807144"],
        ],
        location_type: "PHARMACY",
        provider: "albertsons",
        address_lines: ["11120 S Lakes Dr"],
        city: "Reston",
        state: "VA",
        postal_code: "20191",
        position: {
          longitude: -77.3301191,
          latitude: 38.939619,
        },
        info_phone: "(703) 620-2444",
        info_url:
          "https://local.pharmacy.safeway.com/va/reston/11120-s-lakes-dr.html",
        booking_url: "https://www.mhealthappointments.com/covidappt",
        availability: {
          source: "univaf-albertsons",
          available: "YES",
          products: [
            "pfizer_age_5_11",
            "pfizer_age_0_4",
            "pfizer",
            "moderna",
            "jj",
          ],
          is_public: true,
          checked_at: expectDatetimeString(),
          valid_at: "2021-10-28T07:06:13.000Z",
        },
        meta: {
          albertsons_region: "Virginia",
          mhealth_address:
            "Safeway 0005 - 11120 South Lakes Drive, Reston, VA, 20191",
          timezone: "America/New_York",
          booking_url_adult:
            "https://kordinator.mhealthcoach.net/vcl/1600100807144",
          booking_url_pediatric:
            "https://kordinator.mhealthcoach.net/vcl/1635993536219",
          booking_url_infant:
            "https://kordinator.mhealthcoach.net/vcl/1635993536220",
          booking_urls: [
            {
              available: "YES",
              products: ["pfizer_age_5_11"],
              url: "https://kordinator.mhealthcoach.net/vcl/1635993536219",
            },
            {
              available: "YES",
              products: ["pfizer_age_0_4"],
              url: "https://kordinator.mhealthcoach.net/vcl/1635993536220",
            },
            {
              available: "YES",
              products: ["pfizer", "moderna", "jj"],
              url: "https://kordinator.mhealthcoach.net/vcl/1600100807144",
            },
          ],
        },
        description:
          "Looking for a pharmacy near you in Reston, VA? Our on-site pharmacy can administer Covid vaccinations, Pfizer, Moderna, and J&J Covid second booster shot and flu shots at no additional cost. Fill, refill or transfer prescriptions with us. We welcome scheduled or walk-in immunizations. Back to school vaccine immunizations and covid-19 PCR NAAT walk in test now available. We are located at 11120 S Lakes Dr.",
      },
    ]);
  });

  it("handles locations with pediatric names but no products", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(
        200,
        [
          {
            id: "1610138028763",
            region: "SoCal_-_Pasadena",
            address:
              "Pfizer Child - Albertsons 0393 - 1268 Madera Rd, Simi Valley, CA, 93065",
            lat: "34.2616858",
            long: "-118.7968621",
            coach_url: "https://kordinator.mhealthcoach.net/vcl/1610138028763",
            availability: "no",
            drugName: [],
          },
          {
            id: "1600118533422",
            region: "California_-_San_Diego_4",
            address: "Albertsons 0393 - 1268 Madera Rd, Simi Valley, CA, 93065",
            lat: "34.2616858",
            long: "-118.7968621",
            coach_url: "https://kordinator.mhealthcoach.net/vcl/1600118533422",
            availability: "no",
            drugName: [],
          },
        ],
        { "Last-Modified": "Thu, 28 Oct 2021 07:06:13 GMT" }
      );
    const result = await checkAvailability(() => {}, { states: ["CA"] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchSchema(locationSchema);
    expect(result).toHaveProperty("0.meta", {
      albertsons_region: "California_-_San_Diego_4",
      mhealth_address:
        "Albertsons 0393 - 1268 Madera Rd, Simi Valley, CA, 93065",
      timezone: "America/Los_Angeles",
      booking_url_adult:
        "https://kordinator.mhealthcoach.net/vcl/1600118533422",
      booking_url_pediatric:
        "https://kordinator.mhealthcoach.net/vcl/1610138028763",
      booking_urls: [
        {
          available: "NO",
          products: ["pfizer_age_5_11"],
          url: "https://kordinator.mhealthcoach.net/vcl/1610138028763",
        },
        {
          available: "NO",
          products: undefined,
          url: "https://kordinator.mhealthcoach.net/vcl/1600118533422",
        },
      ],
    });
  });

  it("handles locations without pediatric names but that only have pediatric products", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(
        200,
        [
          {
            id: "1610138028763",
            region: "SoCal_-_Pasadena",
            address: "Albertsons 0393 - 1268 Madera Rd, Simi Valley, CA, 93065",
            lat: "34.2616858",
            long: "-118.7968621",
            coach_url: "https://kordinator.mhealthcoach.net/vcl/1610138028763",
            availability: "no",
            drugName: ["PfizerChild"],
          },
          {
            id: "1600118533422",
            region: "California_-_San_Diego_4",
            address: "Albertsons 0393 - 1268 Madera Rd, Simi Valley, CA, 93065",
            lat: "34.2616858",
            long: "-118.7968621",
            coach_url: "https://kordinator.mhealthcoach.net/vcl/1600118533422",
            availability: "no",
            drugName: [],
          },
        ],
        { "Last-Modified": "Thu, 28 Oct 2021 07:06:13 GMT" }
      );
    const result = await checkAvailability(() => {}, { states: ["CA"] });
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchSchema(locationSchema);
    expect(result).toHaveProperty("0.meta", {
      albertsons_region: "California_-_San_Diego_4",
      mhealth_address:
        "Albertsons 0393 - 1268 Madera Rd, Simi Valley, CA, 93065",
      timezone: "America/Los_Angeles",
      booking_url_adult:
        "https://kordinator.mhealthcoach.net/vcl/1600118533422",
      booking_url_pediatric:
        "https://kordinator.mhealthcoach.net/vcl/1610138028763",
      booking_urls: [
        {
          available: "NO",
          products: ["pfizer_age_5_11"],
          url: "https://kordinator.mhealthcoach.net/vcl/1610138028763",
        },
        {
          available: "NO",
          products: undefined,
          url: "https://kordinator.mhealthcoach.net/vcl/1600118533422",
        },
      ],
    });
  });

  it("should handle community clinics", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(
        200,
        [
          {
            ...basicLocation,
            address:
              "Takoma Park Recreation Center  - 7315 New Hampshire Avenue, Takoma Park, MD, 20912",
          },
        ],
        { "Last-Modified": "Thu, 28 Oct 2021 07:06:13 GMT" }
      );

    const result = await checkAvailability(() => {}, { states: ["MD"] });
    expect(result[0]).toMatchSchema(locationSchema);
    expect(result[0]).toHaveProperty("name", "Takoma Park Recreation Center");
    expect(result[0]).toHaveProperty("location_type", "CLINIC");
    expect(result[0]).toHaveProperty(
      "meta.booking_url_pediatric",
      basicLocation.coach_url
    );
  });

  it("does not output locations that don't match a known brand", async () => {
    nock(API_URL_BASE)
      .get(API_URL_PATH)
      .query(true)
      .reply(
        200,
        [
          {
            ...basicLocation,
            address:
              "Some unknown store #8134 - 7315 Famous Ave., Nowhere, MD, 20912",
          },
        ],
        { "Last-Modified": "Thu, 28 Oct 2021 07:06:13 GMT" }
      );

    const result = await checkAvailability(() => {}, { states: ["MD"] });
    expect(result).toHaveLength(0);
  });

  it("should throw an error when HTTP requests fail", async () => {
    nock(API_URL_BASE).post(API_URL_PATH).reply(500, {
      errors: "Oh no!",
    });

    const error = await checkAvailability(() => null, { states: ["AK"] }).then(
      () => null,
      (error) => error
    );
    expect(error).toBeInstanceOf(Error);
  });

  it("errors when formatting locations with a name and address that can't be separated", () => {
    expect(() => {
      formatLocation({
        ...basicLocation,
        address: "Something 7315 Famous Ave., Nowhere, MD, 20912",
      });
    }).toThrow(ParseError);
  });

  it("errors when formatting locations with a URL for a name", () => {
    expect(() => {
      formatLocation({
        ...basicLocation,
        address:
          "https://kordinator.mhealthcoach.net/vcl/1636075700051 - Vons - 3439 Via Montebello, Carlsbad, CA, 92009",
      });
    }).toThrow(ParseError);
  });

  it("includes manual corrections to locations", () => {
    // Should replace the provided address with this one.
    corrections[basicLocation.id] = {
      address: "Safeway 3410 - 30 College Rd, Fairbanks, AK, 99701",
    };

    expect(
      formatLocation({
        ...basicLocation,
        address: "Whoseywhatsit - some crazy address that's not valid",
      })
    ).toEqual(
      expect.objectContaining({
        name: "Safeway Pharmacy #3410",
        external_ids: [
          ["albertsons", "123456789"],
          ["albertsons_safeway", "123456789"],
          ["safeway", "3410"],
          ["albertsons_store_number", "safeway:3410"],
        ],
        address_lines: ["30 College Rd"],
        city: "Fairbanks",
        state: "AK",
        postal_code: "99701",
      })
    );
  });

  it("removes one-off event dates from location names", () => {
    const formatted = formatLocation({
      ...basicLocation,
      address:
        "Albertsons 0393 - Simi Valley Jun 3 - 1268 Madera Rd, Simi Valley, CA, 93065",
    });

    expect(formatted).toHaveProperty("name", "Albertsons Pharmacy #393");
    expect(formatted).toHaveProperty("address_lines", ["1268 Madera Rd"]);
    expect(formatted).toHaveProperty("city", "Simi Valley");
    expect(formatted).toHaveProperty("state", "CA");
    expect(formatted).toHaveProperty("postal_code", "93065");
  });

  it("removes repeated sections in the address/name", () => {
    const formatted = formatLocation({
      ...basicLocation,
      address:
        "Some info - Happy Lands Church - Some info - 7315 Famous Ave., Nowhere, MD, 20912",
    });

    expect(formatted.name).toEqual("Some info - Happy Lands Church");
  });

  it("removes redundant sections that are already in other parts of the name", () => {
    const longerSectionFirst = formatLocation({
      ...basicLocation,
      address:
        "Happy Lands Church - Some info - Church - 7315 Famous Ave., Nowhere, MD, 20912",
    });
    const longerSectionSecond = formatLocation({
      ...basicLocation,
      address:
        "Church - Happy Lands Church - Some info - 7315 Famous Ave., Nowhere, MD, 20912",
    });

    expect(longerSectionFirst.name).toEqual("Happy Lands Church - Some info");
    expect(longerSectionSecond.name).toEqual("Happy Lands Church - Some info");
  });

  it("finds store number and brand when age ranges might look like store numbers", () => {
    const result = parseNameAndAddress(
      "Pfizer Age 5 to 11 Albertsons 3592  - 15970 Los Serranos City Club Dr, Chino Hills, CA, 91709"
    );
    expect(result).toHaveProperty("storeBrand.key", "albertsons");
    expect(result).toHaveProperty("storeNumber", "3592");
    expect(result).toHaveProperty("address", {
      lines: ["15970 Los Serranos City Club Dr"],
      city: "Chino Hills",
      state: "CA",
      zip: "91709",
    });
  });

  it("finds store number and brand when dates might look like store numbers", () => {
    const result = parseNameAndAddress(
      "Albertsons July 10 Albertsons 3592 - 15970 Los Serranos City Club Dr, Chino Hills, CA, 91709"
    );
    expect(result).toHaveProperty("storeBrand.key", "albertsons");
    expect(result).toHaveProperty("storeNumber", "3592");
    expect(result).toHaveProperty("address", {
      lines: ["15970 Los Serranos City Club Dr"],
      city: "Chino Hills",
      state: "CA",
      zip: "91709",
    });
  });
});
