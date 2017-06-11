<?php

/**
 * @file
 * Paragraphs Previewer widget implementation for paragraphs.
 */

namespace Drupal\paragraphs_previewer\Plugin\Field\FieldWidget;

use Drupal\paragraphs\Plugin\Field\FieldWidget\InlineParagraphsWidget;
use Drupal\Core\Field\FieldDefinitionInterface;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Field\FieldItemListInterface;
use Drupal\Core\Ajax\AjaxResponse;
use Drupal\Core\Ajax\OpenModalDialogCommand;
use Drupal\Core\Ajax\AlertCommand;
use Drupal\Component\Utility\NestedArray;

/**
 * Plugin implementation of the 'entity_reference paragraphs' widget.
 *
 * We hide add / remove buttons when translating to avoid accidental loss of
 * data because these actions effect all languages.
 *
 * @FieldWidget(
 *   id = "entity_reference_paragraphs_previewer",
 *   label = @Translation("Paragraphs Previewer"),
 *   description = @Translation("An paragraphs inline form widget with a previewer."),
 *   field_types = {
 *     "entity_reference_revisions"
 *   }
 * )
 */
class InlineParagraphsPreviewerWidget extends InlineParagraphsWidget {

  const PARAGRAPHS_PREVIEWER_DEFAULT_EDIT_MODE = 'closed';

  /**
   * {@inheritdoc}
   */
  public static function defaultSettings() {
    $settings = parent::defaultSettings();
    $settings['edit_mode'] = static::PARAGRAPHS_PREVIEWER_DEFAULT_EDIT_MODE;
    return $settings;
  }

  /**
   * {@inheritdoc}
   */
  public function settingsSummary() {
    $summary = parent::settingsSummary();
    array_unshift($summary, t('Previewer: Enabled'));
    return $summary;
  }

  /**
   * Determine if the previewer is enabled for the given paragraphs edit mode.
   *
   * @param string $mode
   *   The paragraphs edit mode.
   *
   * @return bool
   *   TRUE if the previewer is enabled.
   */
  public function isPreviewerEnabled($mode) {
    return $mode != 'removed' && $mode != 'remove';
  }

  /**
   * {@inheritdoc}
   *
   * @see \Drupal\content_translation\Controller\ContentTranslationController::prepareTranslation()
   *   Uses a similar approach to populate a new translation.
   */
  public function formElement(FieldItemListInterface $items, $delta, array $element, array &$form, FormStateInterface $form_state) {
    $element = parent::formElement($items, $delta, $element, $form, $form_state);
    $field_name = $this->fieldDefinition->getName();
    $parents = $element['#field_parents'];

    $widget_state = static::getWidgetState($parents, $field_name, $form_state);
    if (!isset($widget_state['paragraphs'][$delta]['mode']) ||
        !isset($widget_state['paragraphs'][$delta]['entity'])) {
      return $element;
    }

    $item_mode = $widget_state['paragraphs'][$delta]['mode'];
    if (!$this->isPreviewerEnabled($item_mode)) {
      return $element;
    }

    $paragraphs_entity = $widget_state['paragraphs'][$delta]['entity'];
    $element_parents = array_merge($parents, [$field_name, $delta]);
    $id_prefix = implode('-', $element_parents);

    $previewer_element = [
      '#type' => 'submit',
      '#value' => t('Preview'),
      '#name' => strtr($id_prefix, '-', '_') . '_previewer',
      '#weight' => 99999,
      '#submit' => [[$this, 'submitPreviewerItem']],
      '#field_item_parents' => $element_parents,
      '#limit_validation_errors' => [
        array_merge($parents, [$field_name, 'add_more']),
      ],
      '#delta' => $delta,
      '#ajax' => [
        'callback' => [get_class($this), 'ajaxSubmitPreviewerItem'],
        'wrapper' => $widget_state['ajax_wrapper_id'],
        'effect' => 'fade',
      ],
      '#access' => $paragraphs_entity->access('view'),
      '#attributes' => [
        'class' => ['link', 'paragraphs-previewer'],
      ],
      '#attached' => [
        'library' => ['paragraphs_previewer/dialog'],
      ],
    ];

    // Set the dialog title.
    if (isset($element['top']['paragraph_type_title']['info']['#markup'])) {
      $previewer_element['#previewer_dialog_title'] = strip_tags($element['top']['paragraph_type_title']['info']['#markup']);
    }
    else {
      $previewer_element['#previewer_dialog_title'] = t('Preview');
    }

    $element['top']['previewer_button'] = $previewer_element;
    return $element;
  }

  /**
   * Previewer button submit callback.
   *
   * @param array $form
   *   The form array.
   * @param FormStateInterface $form_state
   *   The form state.
   */
  public function submitPreviewerItem(array $form, FormStateInterface $form_state) {
    if (!$form_state->isCached()) {
      $form_state->setRebuild();
    }
  }

  /**
   * Previewer button AJAX callback.
   *
   * @param array $form
   *   The form array.
   * @param FormStateInterface $form_state
   *   The form state.
   */
  public function ajaxSubmitPreviewerItem(array $form, FormStateInterface $form_state) {
    $preview_url = NULL;
    $dialog_title = t('Preview');
    $dialog_options = array(
      'dialogClass' => 'paragraphs-previewer-ui-dialog',
      'minWidth' => 320,
      'width' => '98%',
      'minHeight' => 100,
      'height' => 400,
      'autoOpen' => TRUE,
      'modal' => TRUE,
      'draggable' => TRUE,
      'autoResize' => FALSE,
      'resizable' => TRUE,
      'closeOnEscape' => TRUE,
      'closeText' => '',
    );

    $previewer_element = $form_state->getTriggeringElement();

    // Get dialog title.
    if (isset($previewer_element['#previewer_dialog_title'])) {
      $dialog_title = $previewer_element['#previewer_dialog_title'];
    }

    // Build previewer callback url.
    if (!empty($previewer_element['#field_item_parents']) && !empty($form['#build_id'])) {
      $route_name = 'paragraphs_previewer.form_preview';
      $route_parameters = [
        'form_build_id' => $form['#build_id'],
        'element_parents' => implode(':', $previewer_element['#field_item_parents']),
      ];
      $preview_url = \Drupal\Core\Url::fromRoute($route_name, $route_parameters);
    }

    // Build modal content.
    $dialog_content = [
      '#theme' => 'paragraphs_previewer_modal_content',
      '#preview_url' => $preview_url,
    ];

    // Build response.
    $response = new AjaxResponse();

    // Attach the library necessary for using the OpenModalDialogCommand and
    // set the attachments for this Ajax response.
    $form['#attached']['library'][] = 'core/drupal.dialog.ajax';
    $response->setAttachments($form['#attached']);

    // Add modal dialog.
    $response->addCommand(new OpenModalDialogCommand($dialog_title, $dialog_content, $dialog_options));

    return $response;
  }

}
