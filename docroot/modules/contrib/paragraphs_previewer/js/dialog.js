/**
 * @file
 * Paragraphs Previewer handling.
 */

(function ($, Drupal, drupalSettings) {

  'use strict';

  var previewer = {};

  /**
   * Reset extended dialog properties.
   *
   * @param Drupal.dialog dialog
   *   The dialog object
   */
  previewer.dialogReset = function(dialog) {
    dialog.isLoading = false;
    dialog.loadedCount = 0;
    dialog.loadableCount = 0;
  };

  /**
   * Set the initial dialog settings based on client side information.
   *
   * @param Drupal.dialog dialog
   *   The dialog object
   * @param jQuery $element
   *   The element jQuery object.
   * @param object $settings
   *   Optional The combined dialog settings.
   */
  previewer.dialogInitialize = function(dialog, $element, settings) {
    dialog.isLoading = true;
    dialog.loadedCount = 0;
    dialog.loadableCount = 0;

    var windowHeight = $(window).height();
    if (windowHeight > 0) {
      // Set maxHeight based on calculated pixels.
      // Setting a relative value (100%) server side did not allow scrolling
      // within the modal.
      settings.maxHeight = windowHeight;
    }
  };

  /**
   * Set the dialog settings based on the content.
   *
   * @param Drupal.dialog dialog
   *   The dialog object
   * @param jQuery $element
   *   The element jQuery object.
   * @param object $settings
   *   The combined dialog settings.
   */
  previewer.dialogUpdateForContent = function(dialog, $element, settings) {
    if (!dialog.isLoading && settings.maxHeight) {
      var $content = $('.paragraphs-previewer-iframe', $element).contents().find('body');

      if ($content.length) {
        // Fit content.
        var contentHeight = $content.outerHeight();
        var modalContentContainerHeight = $element.height();

        var fitHeight;
        if (contentHeight < modalContentContainerHeight) {
          var modalHeight = $element.parent().outerHeight();
          var modalNonContentHeight = modalHeight - modalContentContainerHeight
          fitHeight = contentHeight + modalNonContentHeight
        }
        else {
          fitHeight = 0.98 * settings.maxHeight;
        }

        // Set to the new height bounded by min and max.
        var newHeight = fitHeight;
        if (fitHeight < settings.minHeight) {
           newHeight = settings.minHeight;
        }
        else if (fitHeight > settings.maxHeight) {
          newHeight = settings.maxHeight;
        }
        settings.height = newHeight;
        $element.dialog('option', 'height', settings.height);
      }
    }
  };
  
  /**
   * Load listener to set content height.
   *
   * @param Drupal.dialog dialog
   *   The dialog object
   * @param jQuery $element
   *   The element jQuery object.
   * @param object $settings
   *   The combined dialog settings.
   */
  previewer.dialogLoader = function(dialog, $element, settings) {
    var $loadedElements = $('iframe, img, video', $element);
    dialog.loadableCount = $loadedElements.length;
    if (dialog.loadableCount) {
      // Update settings after all content is loaded.
      $loadedElements.load(function(loadEvent) {
        dialog.loadedCount++;
        if (dialog.loadedCount == dialog.loadableCount) {
          dialog.isLoading = false;
          $element.addClass('paragraphs-previewer-dialog-loaded')
          previewer.dialogUpdateForContent(dialog, $element, settings);
        }
      });
    }
    else {
      // No update needed since height is 'auto'.
      dialog.isLoading = false;
      $element.addClass('paragraphs-previewer-dialog-loaded')
    }
  };

  /**
   * Determine if an dialog event is a previewer dialog.
   *
   * @param Drupal.dialog dialog
   *   The dialog object
   * @param jQuery $element
   *   The element jQuery object.
   * @param object $settings
   *   Optional. The combined dialog settings.
   *
   * @return bool
   *   TRUE if the dialog is a previewer dialog.
   */
  previewer.dialogIsPreviewer = function(dialog, $element, settings) {
    var dialogClass = '';
    if (typeof settings == 'object' && ('dialogClass' in settings)) {
      dialogClass = settings.dialogClass;
    }
    else if ($element.length && !!$element.dialog) {
      dialogClass = $element.dialog('option', 'dialogClass');
    }

    return dialogClass && dialogClass.indexOf('paragraphs-previewer-ui-dialog') > -1;
  };

  // Dialog listeners.
  $(window).on({
    'dialog:beforecreate': function (event, dialog, $element, settings) {
      if (previewer.dialogIsPreviewer(dialog, $element, settings)) {
        // Initialize the dialog.
        previewer.dialogInitialize(dialog, $element, settings);
      }
    },
    'dialog:aftercreate': function (event, dialog, $element, settings) {
      if (previewer.dialogIsPreviewer(dialog, $element, settings)) {
        // Set body class to disable scrolling.
        $('body').addClass('paragraphs-previewer-dialog-active');

        // Adjust dialog after all content is loaded.
        previewer.dialogLoader(dialog, $element, settings);
      }
    },
    'dialog:afterclose': function (event, dialog, $element) {
      if (previewer.dialogIsPreviewer(dialog, $element)) {
        // Reset extended properties.
        previewer.dialogReset(dialog);

        // Remove body class to enable scrolling in the parent window.
        $('body').removeClass('paragraphs-previewer-dialog-active');
      }
    }
  });

})(jQuery, Drupal, drupalSettings);
