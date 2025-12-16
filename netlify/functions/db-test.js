import { neon } from "@netlify/neon";

export async function handler() {
  try {
    // This automatically uses NETLIFY_DATABASE_URL
    const sql = neon();

    const result = await sql`SELECT NOW() as time`;

    return {
      statusCode: 200,
      body: JSON.stringify({
        ok: true,
        db_time: result[0].time
      })
    };

  } catch (err) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        ok: false,
        error: err.message
      })
    };
  }
}
