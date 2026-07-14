import { createDb } from "./index";
import { seedDomain } from "./seed-data";

const db = createDb(process.env.DATABASE_URL ?? "postgres://mams:mams@localhost:5433/mams");

seedDomain(db)
  .then(() => {
    console.log("Domain seed complete.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
