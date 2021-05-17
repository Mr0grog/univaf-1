import fs from "fs/promises";
import { createLocation, updateAvailability, db } from "../src/db";

async function readSeedData() {
  const raw = await fs.readFile("./fixtures/seeds.json", "utf8");
  return JSON.parse(raw);
}

async function insertSeeds(seedData: Array<any>) {
  for (let locationData of seedData) {
    const location = await createLocation(locationData);
    await updateAvailability(location.id, { ...locationData.availability });
    console.log("Inserted:", location.id);
  }
}

async function run() {
  const data = await readSeedData();
  await insertSeeds(data);
}

run()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());