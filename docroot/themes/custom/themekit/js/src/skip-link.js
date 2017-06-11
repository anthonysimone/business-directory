/**
 * @file
 * Skip link for accessibility
 * 
 * We are only making the 
 */

!function ($) {
  // Always use strict mode to enable better error handling in modern browsers.
  "use strict";


  $(function() {

    let $skipLinkHolder = $('#skip-to-content'),
        $skipLink = $skipLinkHolder.find('.skip-to-content-link');

    $skipLink.on('click', function(e) {
      e.preventDefault();
      let $target = $($(this).attr('href'));
      $target.attr('tabindex', '-1');
      $target.focus();
      $target.on('blur focusout', function() {
        $(this).removeAttr('tabindex');
      });
    });

  });

}(jQuery);