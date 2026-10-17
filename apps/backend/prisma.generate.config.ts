import { defineConfig } from 'prisma/config';

// Client generation is a build operation, not a database operation.
// Keep migration credentials and dotenv loading out of Render builds.
export default defineConfig({ schema: 'prisma/schema.prisma' });
