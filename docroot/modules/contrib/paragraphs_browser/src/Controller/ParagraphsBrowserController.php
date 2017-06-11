<?php

namespace Drupal\paragraphs_browser\Controller;

use Drupal\Core\Ajax\AjaxResponse;
use Drupal\Core\Ajax\OpenModalDialogCommand;
use Drupal\Core\Controller\ControllerBase;

/**
 * Class EntityBrowserController.
 *
 * @package Drupal\paragraphs_browser\Controller
 */
class ParagraphsBrowserController extends ControllerBase {

  /**
   * Route callback that returns the Paragraphs Browser form within a modal.
   *
   * @return string
   *   Returns the Ajax response to open dialog.
   */
  public function paragraphsBrowserSelect($field_config, $paragraphs_browser_type, $uuid) {
    $form = \Drupal::formBuilder()->getForm('Drupal\paragraphs_browser\Form\ParagraphsBrowserForm', $field_config, $paragraphs_browser_type, $uuid);

    $form['#attached']['library'][] = 'paragraphs_browser/modal';
    $title = "Browse";
    $response = AjaxResponse::create()->addCommand(new OpenModalDialogCommand($title, $form, ['modal' => TRUE, 'width' => 800]));
    return $response;
  }

}
