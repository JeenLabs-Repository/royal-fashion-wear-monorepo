import {
  ContainerRegistrationKeys,
  defineConfig,
  loadEnv,
  Modules,
} from "@medusajs/framework/utils";
import {
  assertProductionConfig,
  DEV_FALLBACK_SECRET,
  warnWeakConfig,
} from "./src/lib/production-config";

loadEnv(process.env.NODE_ENV || "development", process.cwd());

const isProd = process.env.NODE_ENV === "production";
const redisUrl = process.env.REDIS_URL;

// An image build runs `medusa build` without any secret present, so only the
// commands that boot the backend are held to the production rules.
const isBuildCommand = process.argv[2] === "build";

if (isProd && !isBuildCommand) {
  assertProductionConfig(process.env);
} else {
  warnWeakConfig(process.env, console.warn);
}

// create-medusa-app writes REDIS_URL into every generated .env whether Redis runs
// or not, so development requires an explicit opt-in.
const useRedis = Boolean(redisUrl) && (isProd || process.env.USE_REDIS === "true");
const useSmtp = Boolean(process.env.SMTP_HOST);
const useS3 = isProd && Boolean(process.env.S3_BUCKET);

const smtpProvider = {
  resolve: "./src/modules/smtp-notification",
  id: "smtp",
  options: {
    channels: ["email"],
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined,
    secure: process.env.SMTP_SECURE === "true",
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.SMTP_FROM,
    // Shown as the sender's name in the inbox, so the subject lines can stay
    // about the order alone.
    from_name: process.env.STORE_NAME,
    reply_to: process.env.SMTP_REPLY_TO,
  },
};

const redisModules = [
  {
    resolve: "@medusajs/medusa/cache-redis",
    options: { redisUrl: process.env.CACHE_REDIS_URL || redisUrl },
  },
  {
    resolve: "@medusajs/medusa/event-bus-redis",
    options: { redisUrl },
  },
  {
    resolve: "@medusajs/medusa/workflow-engine-redis",
    options: { redis: { url: redisUrl } },
  },
];

const s3Module = {
  resolve: "@medusajs/medusa/file",
  options: {
    providers: [
      {
        resolve: "@medusajs/medusa/file-s3",
        id: "s3",
        options: {
          file_url: `${process.env.S3_ENDPOINT}/${process.env.S3_BUCKET}`,
          access_key_id: process.env.S3_ACCESS_KEY,
          secret_access_key: process.env.S3_SECRET_KEY,
          region: process.env.S3_REGION,
          bucket: process.env.S3_BUCKET,
          endpoint: process.env.S3_ENDPOINT,
          additional_client_config: { forcePathStyle: true },
        },
      },
    ],
  },
};

module.exports = defineConfig({
  projectConfig: {
    databaseUrl: process.env.DATABASE_URL,
    // The database sits on a private network, so TLS on that link is the
    // operator's choice: set DATABASE_SSL=true to turn it on.
    databaseDriverOptions: {
      connection: {
        ssl:
          process.env.DATABASE_SSL === "true"
            ? {
                rejectUnauthorized:
                  process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false",
              }
            : false,
      },
    },
    // Production requires REDIS_URL (the check above refuses to start without
    // it), so sessions, events and workflows survive a restart.
    redisUrl: useRedis ? redisUrl : undefined,
    http: {
      storeCors: process.env.STORE_CORS!,
      adminCors: process.env.ADMIN_CORS!,
      authCors: process.env.AUTH_CORS!,
      jwtSecret: process.env.JWT_SECRET || DEV_FALLBACK_SECRET,
      cookieSecret: process.env.COOKIE_SECRET || DEV_FALLBACK_SECRET,
      // Bearer tokens last one day; the dashboard session below lasts 8 hours.
      jwtExpiresIn: "1d",
      // The vendor actor signs in with email and password like staff do. Without
      // an entry here Medusa refuses every sign-in for it.
      authMethodsPerActor: {
        user: ["emailpass"],
        customer: ["emailpass"],
        vendor: ["emailpass"],
      },
      // An identity with no actor link must not receive a usable token (actor
      // mechanics record).
      requireActorAssociation: {
        emailpass: true,
      },
    },
    // Milliseconds: 8 hours.
    sessionOptions: {
      ttl: 8 * 60 * 60 * 1000,
    },
    cookieOptions: {
      // "lax" stays: the storefront's payment return flow needs the cookie on
      // a top-level redirect back from the payment page.
      sameSite: "lax",
      secure: isProd || process.env.COOKIE_SECURE === "true",
    },
  },
  featureFlags: {
    translation: true,
  },
  plugins: [
    {
      resolve: "@gorgo/medusa-integration",
      options: {
        encryptionKey: process.env.INTEGRATION_ENCRYPTION_KEY,
        // Integration providers plug in here. Browse the catalog at
        // https://gorgojs.com/medusa/plugins?integrationModule=true or read
        // https://docs.gorgojs.com/medusa-modules/integration
        providers: [],
      },
    },
  ],
  modules: [
    { resolve: "@medusajs/medusa/translation" },
    {
      // Declared explicitly so the two-step sign-in options are in code.
      resolve: "@medusajs/medusa/auth",
      dependencies: [Modules.CACHE, ContainerRegistrationKeys.LOGGER],
      options: {
        providers: [{ resolve: "@medusajs/medusa/auth-emailpass", id: "emailpass" }],
        mfa: {
          encryption_key: process.env.AUTH_MFA_ENCRYPTION_KEY,
          // A session alone cannot switch two-step sign-in off; the user has to
          // pass a challenge first.
          disable_policy: "challenge",
        },
      },
    },
    { resolve: "./src/modules/staff-access" },
    { resolve: "./src/modules/audit-log" },
    { resolve: "./src/modules/vendor" },
    { resolve: "./src/modules/vendor-catalog" },

    {
      resolve: "@medusajs/medusa/notification",
      options: {
        providers: [
          {
            resolve: "@medusajs/medusa/notification-local",
            id: "local",
            options: {
              name: "Local Notification Provider",
              channels: ["feed"],
            },
          },
          ...(useSmtp ? [smtpProvider] : []),
        ],
      },
    },
    ...(useRedis ? redisModules : []),
    ...(useS3 ? [s3Module] : []),
  ],
});
