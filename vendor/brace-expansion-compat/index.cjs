"use strict";

const current = require("brace-expansion-v5");

// minimatch 3 expects a callable export; minimatch 10 reads `.expand`.
module.exports = Object.assign(current.expand, current);
