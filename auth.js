'use strict';
/**
 * Who is using the app?
 *
 * Sign-in is intentionally NOT turned on yet (to be added later, as was done for the CCH Legal app).
 * Until then everyone who can reach the URL is treated as an editor.
 *
 * To add sign-in later, replace identify() with one that reads your single sign-on / proxy headers
 * and returns { role: 'editor' | 'viewer', name, uid }, or returns null to answer 401.
 * Nothing else in the app needs to change.
 */
function identify(/* req */) {
  return { role: 'editor', name: 'CCH user', uid: 'cch-user' };
}

module.exports = { identify };
