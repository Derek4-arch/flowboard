/* Modules shared with the browser (public/js/shared). They are UMD files, so Node can require them directly. */
'use strict';
const path = require('node:path');
const dir = path.join(__dirname, '..', 'public', 'js', 'shared');
module.exports = {
  validate: require(path.join(dir, 'validate.js')),
  markdown: require(path.join(dir, 'markdown.js')),
  activityText: require(path.join(dir, 'activity-text.js'))
};
