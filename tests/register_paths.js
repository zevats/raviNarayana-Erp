const path = require("path");
const { createRequire } = require("module");

const erpPackageJson = path.resolve(__dirname, "../apps/erp/package.json");
const erpRequire = createRequire(erpPackageJson);

const Module = require("module");
const originalRequire = Module.prototype.require;

Module.prototype.require = function (id) {
  try {
    return originalRequire.apply(this, arguments);
  } catch (err) {
    if (err && err.code === "MODULE_NOT_FOUND") {
      try {
        return erpRequire(id);
      } catch {
        throw err;
      }
    }
    throw err;
  }
};
