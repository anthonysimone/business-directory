<?php

/**
 * @file
 * Paragraphs Previewer widget implementation for paragraphs.
 */

namespace Drupal\paragraphs_browser\Plugin\Field\FieldWidget;

use Drupal\Component\Serialization\Json;
use Drupal\Core\Url;
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
 *   id = "entity_reference_paragraphs_browser",
 *   label = @Translation("Paragraphs Browser"),
 *   description = @Translation("An paragraphs inline form widget with a previewer."),
 *   field_types = {
 *     "entity_reference_revisions"
 *   }
 * )
 */
class InlineParagraphsBrowserWidget extends InlineParagraphsWidget {


  /**
   * {@inheritdoc}
   */
  public static function defaultSettings() {
    $settings = parent::defaultSettings();
    $settings['paragraphs_browser'] = '_na';
    return $settings;
  }
  public function settingsForm(array $form, FormStateInterface $form_state) {
    $elements = parent::settingsForm($form, $form_state);
    $elements['add_mode'] = array(
      '#type' => 'hidden',
      '#value' => 'paragraphs_browser'
    );

    $paragraph_browsers = entity_load_multiple('paragraphs_browser_type');
    $options = array('_na' => 'No Groups');
    foreach($paragraph_browsers as $type) {
      $options[$type->id] = $type->label;
    }
    $elements['paragraphs_browser'] = array(
      '#type' => 'select',
      '#title' => $this->t('Paragraphs Browser'),
      '#description' => $this->t('Select which browser to use.'),
      '#options' => $options,
      '#default_value' => $this->getSetting('paragraphs_browser'),
      '#required' => TRUE,
    );

    return $elements;
  }


  public function formMultipleElements(FieldItemListInterface $items, array &$form, FormStateInterface $form_state) {
    $elements = parent::formMultipleElements($items, $form, $form_state);

    // If the Paragraph browser hasn't been set, return un-modified form.
    if ($this->getSetting('paragraphs_browser') == '_na') {
      return $elements;
    }

//    $elements['add_more'] = array(
//      '#type' => 'container',
//      '#theme_wrappers' => array('paragraphs_dropbutton_wrapper'),
//    );
    if (empty($this->uuid)) {
      $this->uuid = \Drupal::service('uuid')->generate();
    }
    $elements['add_more']['add_more_select']['#attributes']['data-uuid'] = $this->uuid;
    $elements['add_more']['add_more_select']['#attributes']['class'][] = 'js-hide';
    $elements['add_more']['add_more_select']['#title_display'] = 'hidden';
    $elements['add_more']['add_more_button']['#attributes']['data-uuid'] = $this->uuid;
    $elements['add_more']['add_more_button']['#attributes']['class'][] = 'js-hide';
    unset($elements['add_more']['add_more_button']['#suffix']);
    unset($elements['add_more']['add_more_button']['#prefix']);

    $elements['#attached']['library'][] = 'paragraphs_browser/modal';
    $elements['add_more']['browse'] = array(
        '#type' => 'submit',
        '#value' => $this->t('Add :title', [':title' => $this->getSetting('title')]),
        '#attributes' => ['class' => ['js-show']],
        '#ajax' => [
          'url' => Url::fromRoute(
            'paragraphs_browser.paragraphs_browser_controller', [
              'field_config' => implode('.', array($items->getEntity()->getEntityTypeId(), $items->getEntity()->bundle(), $this->fieldDefinition->getName())),
              'paragraphs_browser_type' => $this->getSetting('paragraphs_browser'),
              'uuid' => $this->uuid,
            ]
          ),
        ],
    );

    return $elements;
  }

}
