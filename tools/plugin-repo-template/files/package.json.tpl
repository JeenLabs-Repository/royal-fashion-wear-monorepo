{
  "name": "@@PACKAGE@@",
  "version": "0.0.0",
  "description": "@@DESCRIPTION@@",
  "license": "UNLICENSED",
  "private": false,
  "repository": {
    "type": "git",
    "url": "git+https://github.com/@@OWNER@@/@@NAME@@.git"
  },
  "publishConfig": {
    "registry": "@@REGISTRY@@"
  },
  "files": [
    ".medusa/server"
  ],
  "main": ".medusa/server/src/index.js",
  "engines": {
    "node": ">=22.23.4"
  },
  "packageManager": "pnpm@12.18.0",
  "exports": {
    "./package.json": "./package.json",
    "./public": "./.medusa/server/src/public.js",
    "./workflows": "./.medusa/server/src/workflows/index.js",
    "./.medusa/server/src/modules/*": "./.medusa/server/src/modules/*/index.js",
    "./modules/*": "./.medusa/server/src/modules/*/index.js",
    "./providers/*": "./.medusa/server/src/providers/*/index.js",
    "./admin": {
      "import": "./.medusa/server/src/admin/index.mjs",
      "require": "./.medusa/server/src/admin/index.js",
      "default": "./.medusa/server/src/admin/index.js"
    },
    "./*": "./.medusa/server/src/*.js"
  },
  "scripts": {
    "build": "medusa plugin:build",
    "dev": "medusa plugin:develop",
    "publish:local": "medusa plugin:publish",
    "db:generate": "medusa plugin:db:generate",
    "lint": "medusa lint",
    "typecheck": "tsc --noEmit",
    "test:unit": "TEST_TYPE=unit NODE_OPTIONS=--experimental-vm-modules jest --silent --runInBand --forceExit --passWithNoTests",
    "test:integration:modules": "TEST_TYPE=integration:modules NODE_OPTIONS=--experimental-vm-modules jest --silent=false --runInBand --forceExit --passWithNoTests",
    "guards": "node scripts/run-guards.mjs",
    "prepare": "husky",
    "release:prepare": "sh scripts/release-prepare.sh",
    "release:tag": "sh scripts/release-tag.sh"
  }
}
