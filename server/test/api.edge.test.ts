import { useServerForTests, installTestDatabaseHooks } from "./lib";
import { getApiKeys } from "../src/config";
import app from "../src/app";
import { createLocation, getLocationById, updateAvailability } from "../src/db";
import { TestLocation } from "./fixtures";
import { Availability } from "../src/interfaces";

installTestDatabaseHooks();

describe("GET /api/edge/locations", () => {
  const context = useServerForTests(app);

  it("responds with a list of locations", async () => {
    const location = await createLocation(TestLocation);
    await updateAvailability(location.id, TestLocation.availability);
    const res = await context.client.get<any>("api/edge/locations");
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("responds with a list of locations filtered by state", async () => {
    const location = await createLocation(TestLocation);
    await updateAvailability(location.id, TestLocation.availability);

    let res = await context.client.get<any>("api/edge/locations?state=AK");
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);

    res = await context.client.get<any>("api/edge/locations?state=NJ");
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });

  it("responds with a list of locations filtered by provider", async () => {
    const location = await createLocation(TestLocation);
    await updateAvailability(location.id, TestLocation.availability);

    let res = await context.client.get<any>(
      "api/edge/locations?provider=MISSING"
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(0);

    res = await context.client.get<any>("api/edge/locations?provider=NJVSS");
    expect(res.statusCode).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});

describe("GET /api/edge/locations/:id", () => {
  const context = useServerForTests(app);

  it("responds with location status", async () => {
    const location = await createLocation(TestLocation);
    await updateAvailability(location.id, TestLocation.availability);

    const res = await context.client.get<any>(
      `api/edge/locations/${location.id}`
    );
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("data.id", location.id);
    expect(res.body).toHaveProperty("data.name", TestLocation.name);
    expect(res.body).toHaveProperty(
      "data.location_type",
      TestLocation.location_type
    );
  });
});

describe("POST /api/edge/update", () => {
  const context = useServerForTests(app);

  const headers = {
    Accept: "application/json",
    "x-api-key": getApiKeys()[0],
  };

  it("updates location metadata successfully", async () => {
    const location = await createLocation(TestLocation);
    const newName = "New Name";

    let res = await context.client.post("api/edge/update?update_location=1", {
      headers,
      json: {
        id: location.id,
        name: newName,
      },
    });
    expect(res.statusCode).toBe(200);

    res = await context.client.get(`api/edge/locations/${location.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("data.id", location.id);
    expect(res.body).toHaveProperty("data.name", newName);
  });

  it("updates availability successfully", async () => {
    const location = await createLocation(TestLocation);

    let res = await context.client.post("api/edge/update", {
      headers,
      json: {
        id: location.id,
        availability: {
          source: "NJVSS Export",
          available: "NO",
          checked_at: new Date(),
        },
      },
    });
    expect(res.statusCode).toBe(200);

    res = await context.client.get(`api/edge/locations/${location.id}`);
    expect(res.statusCode).toBe(200);

    expect(res.body).toHaveProperty("data.id", location.id);
    expect(res.body).toHaveProperty("data.availability.available", "NO");

    res = await context.client.post("api/edge/update", {
      headers,
      json: {
        id: location.id,
        availability: {
          source: "NJVSS Export",
          available: "UNKNOWN",
          checked_at: new Date(),
        },
      },
    });
    expect(res.statusCode).toBe(200);

    res = await context.client.get(`api/edge/locations/${location.id}`);
    expect(res.statusCode).toBe(200);
    expect(res.body).toHaveProperty("data.id", location.id);
    expect(res.body).toHaveProperty("data.availability.available", "UNKNOWN");
  });

  it("updates location metadata based on `external_ids` if location matching `id` does not exist", async () => {
    const location = await createLocation(TestLocation);
    const newName = "New Name";
    const externalId = Object.entries(TestLocation.external_ids)[0];

    const res = await context.client.post("api/edge/update?update_location=1", {
      headers,
      json: {
        id: "32C0495C-A1F4-45D4-9962-F8DCBF0E1E6F",
        external_ids: {
          [externalId[0]]: externalId[1],
        },
        name: newName,
      },
    });
    expect(res.statusCode).toBe(200);

    const result = await getLocationById(location.id);
    expect(result).toHaveProperty("name", newName);
  });

  it("updates location metadata based on `external_ids` if `id` is not in update data", async () => {
    const location = await createLocation(TestLocation);
    const newName = "New Name";
    const externalId = Object.entries(TestLocation.external_ids)[0];

    const res = await context.client.post("api/edge/update?update_location=1", {
      headers,
      json: {
        external_ids: {
          [externalId[0]]: externalId[1],
        },
        name: newName,
      },
    });
    expect(res.statusCode).toBe(200);

    const result = await getLocationById(location.id);
    expect(result).toHaveProperty("name", newName);
  });

  it("should not update based on vtrcks PINs", async () => {
    await createLocation(TestLocation);
    const newName = "New Name";

    const res = await context.client.post("api/edge/update?update_location=1", {
      headers,
      json: {
        external_ids: {
          vtrcks: TestLocation.external_ids.vtrcks,
        },
        name: newName,
      },
    });
    expect(res.statusCode).toBe(201);
  });

  it("merges new values into the existing list of external_ids", async () => {
    const location = await createLocation(TestLocation);

    const response = await context.client.post(
      "api/edge/update?update_location=1",
      {
        headers,
        json: {
          id: location.id,
          external_ids: {
            testid: "this is a test",
          },
        },
      }
    );
    expect(response.statusCode).toBe(200);

    const result = await getLocationById(location.id);
    expect(result.external_ids).toEqual({
      ...TestLocation.external_ids,
      testid: "this is a test",
    });
  });

  it("merges new values into the existing meta field", async () => {
    const location = await createLocation(TestLocation);

    const response = await context.client.post(
      "api/edge/update?update_location=1",
      {
        headers,
        json: {
          id: location.id,
          meta: {
            test: "this is a test",
          },
        },
      }
    );
    expect(response.statusCode).toBe(200);

    const result = await getLocationById(location.id);
    expect(result.meta).toEqual({
      ...TestLocation.meta,
      test: "this is a test",
    });
  });

  it("falls back to external_ids when id is not a UUID", async () => {
    const location = await createLocation(TestLocation);

    const response = await context.client.post(
      "api/edge/update?update_location=1",
      {
        headers,
        json: {
          id: "abc123",
          external_ids: { njiis: "nj1234" },
          meta: {
            test: "this is a test",
          },
        },
      }
    );
    expect(response.statusCode).toBe(200);

    const result = await getLocationById(location.id);
    expect(result.meta).toEqual({
      ...TestLocation.meta,
      test: "this is a test",
    });
  });

  it("should valid basic types in availability", async () => {
    const location = await createLocation(TestLocation);
    const response = await context.client.post("update", {
      headers,
      json: {
        id: location.id,
        availability: {
          source: "test-source",
          valid_at: new Date().toISOString(),
          available: Availability.YES,
          available_count: "hello",
        },
      },
      throwHttpErrors: false,
    });
    expect(response.statusCode).toBe(422);
  });
});