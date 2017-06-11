/**
 * @file entity-browser-improvements.js
 *
 * Adds extra UI improvements to all entity browsers in the admin theme.
 */

!function($){
  "use strict";

  Drupal.behaviors.entityBrowserImprover = {
    attach: function(context, settings) {
      let $browserCol = $('.entity-browser-form .views-col', context);

      $browserCol.click(function() {
        let $checkbox = $(this).find('input[type="checkbox"]');

        $checkbox.prop("checked", !$checkbox.prop("checked"));
        $(this).toggleClass('column-selected');
      });
    }
  };

}(jQuery);