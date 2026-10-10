'use strict';

/**
 * Historical migration slot retained so databases that recorded this
 * upstream filename keep the same migration ledger. Email queue storage is
 * retired and removed by migration 245, so this transformation is no longer
 * needed on fresh installs or upgrades.
 */
exports.up = async function up() {};

exports.down = async function down() {
  // Data normalisation; the text shapes are gone and were never correct.
};
