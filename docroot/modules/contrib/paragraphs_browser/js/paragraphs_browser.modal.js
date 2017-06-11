/**
 * @file paragraphs_browser.modal.js
 *
 */

(function ($, Drupal, drupalSettings) {

  'use strict';

  Drupal.AjaxCommands.prototype.paragraphs_browser_add_paragraph = function (ajax, response, status) {
    $('select[data-uuid="' + response.uuid + '"]').val(response.paragraph_type);
    $('input[data-uuid="' + response.uuid + '"]').trigger('mousedown');
  };

}(jQuery, Drupal, drupalSettings));
