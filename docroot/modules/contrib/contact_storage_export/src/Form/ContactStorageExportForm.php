<?php

namespace Drupal\contact_storage_export\Form;

use Drupal\Core\Datetime\Entity\DateFormat;
use Drupal\Core\Form\FormBase;
use Drupal\Core\Form\FormStateInterface;
use Symfony\Component\HttpFoundation\Request;
use Drupal\contact_storage_export\ContactStorageExport;

/**
 * Settings form for config devel.
 */
class ContactStorageExportForm extends FormBase {

  /**
   * Request object.
   *
   * @var Request $request
   */
  protected $request;

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'contact_storage_export';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state, Request $request = NULL) {

    $contact_form = $request->get('contact_form');
    if ($contact_form) {
      return $this->exportForm($contact_form, $form, $form_state, $request);
    }
    else {
      return $this->contactFormSelection($form, $form_state, $request);
    }

  }

  /**
   * Form for exporting a particular form.
   *
   * @param string $contact_form
   *   The machine name of the contact form.
   * @param array $form
   *   The Drupal form.
   * @param FormStateInterface $form_state
   *   The current form state.
   * @param Request $request
   *   The request object.
   *
   * @return array
   *   The Drupal form.
   */
  protected function exportForm($contact_form, array $form, FormStateInterface $form_state, Request $request = NULL) {

    $contact_message = $this->getSingleMessage($contact_form);
    if (!$contact_message) {

      $message = $this->t('There are no messages to be exported for this form.');
      drupal_set_message($message, 'warning');

    }
    else {

      // Store the requested contact form.
      $form['contact_form'] = [
        '#type' => 'hidden',
        '#value' => $contact_form,
      ];

      // Allow the editor to only export messages since last export.
      $form['since_last_export'] = [
        '#type' => 'checkbox',
        '#title' => t('Only export new messages since the last export'),
      ];
      $last_id = ContactStorageExport::getLastExportId($contact_form);
      if (!$this->getSingleMessage($contact_form, $last_id)) {
        $form['since_last_export']['#disabled'] = TRUE;
        $form['since_last_export']['#description'] = $this->t('This checkbox has been disabled as there are not new messages since your last export.');
      }

      $form['advanced'] = array(
        '#type' => 'details',
        '#title' => $this->t('Advanced Settings'),
        '#open' => FALSE,
      );

      // Allow the editor to control which columns are to be exported.
      $labels = ContactStorageExport::getLabels([$contact_message], []);
      unset($labels['uuid']);
      $form['advanced']['columns'] = [
        '#type' => 'checkboxes',
        '#title' => t('Columns to be exported'),
        '#required' => TRUE,
        '#options' => $labels,
        '#default_value' => array_keys($labels),
      ];

      // Allow the editor to override the default file name.
      $filename = str_replace('_', '-', $contact_form);
      $filename .= '-' . date('Y-m-d--h-i-s');
      $filename .= '.csv';
      $form['advanced']['filename'] = [
        '#type' => 'textfield',
        '#title' => t('File name'),
        '#required' => TRUE,
        '#default_value' => $filename,
      ];

      $form['advanced']['date_format'] = [
        '#type' => 'select',
        '#title' => $this->t('Created date format'),
        '#options' => $this->getDateFormats(),
        '#default_value' => 'medium',
      ];

      $form['actions']['#type'] = 'actions';
      $form['actions']['submit'] = [
        '#type' => 'submit',
        '#value' => $this->t('Export'),
        '#button_type' => 'primary',
      ];

      // Open form in new window as our batch finish downloads the file.
      if (!isset($form['#attributes'])) {
        $form['#attributes'] = [];
      }

    }

    return $form;
  }

  /**
   * Form for choosing a form to export.
   *
   * @param array $form
   *   The Drupal form.
   * @param FormStateInterface $form_state
   *   The current form state.
   * @param Request $request
   *   The request object.
   *
   * @return array
   *   The Drupal form.
   */
  protected function contactFormSelection(array $form, FormStateInterface $form_state, Request $request = NULL) {
    if ($bundles = entity_get_bundles('contact_message')) {

      $options = [];
      foreach ($bundles as $key => $bundle) {
        $options[$key] = $bundle['label'];
      }

      $form['contact_form'] = [
        '#type' => 'select',
        '#title' => t('Contact form'),
        '#options' => $options,
        '#required' => TRUE,
      ];

      $form['#attributes']['method'] = 'get';

      $form['actions']['#type'] = 'actions';
      $form['actions']['submit'] = [
        '#type' => 'submit',
        '#value' => $this->t('Select form'),
        '#button_type' => 'primary',
      ];

    }
    else {
      $message = $this->t('You must create a contact form first before you can export.');
      drupal_set_message($message, 'warning');
    }

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state) {
    $settings = $form_state->getValues();
    if ($settings['since_last_export']) {
      $last_id = ContactStorageExport::getLastExportId($settings['contact_form']);
      if (!$this->getSingleMessage($settings['contact_form'], $last_id)) {
        $message = $this->t('There have been no new messages since the last export.');
        $form_state->setErrorByName('since_last_export', $message);
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {

    // Path to the batch processing.
    $path = drupal_get_path('module', 'contact_storage_export');
    $path .= '/src/ContactStorageExportBatches.php';

    // Information to pass to the batch processing.
    $settings = $form_state->getValues();
    $settings['columns'] = array_filter($settings['columns']);

    $batch = [
      'title' => t('Exporting'),
      'operations' => [
        ['_contact_storage_export_process_batch', [$settings]],
      ],
      'finished' => '_contact_storage_export_finish_batch',
      'file' => $path,
    ];
    batch_set($batch);

  }

  /**
   * Gets a single contact message.
   *
   * @param string $contact_form
   *   The machine name of the contact form.
   *
   * @return boolean or contact_message
   *   False or a single contact_message entity.
   */
  protected function getSingleMessage($contact_form, $since_last_id = 0) {
    $query = \Drupal::entityQuery('contact_message');
    $query->condition('contact_form', $contact_form);
    $query->condition('id', $since_last_id, '>');
    $query->range(0, 1);
    if ($mids = $query->execute()) {
      $mid = reset($mids);
      if ($message = entity_load('contact_message', $mid)) {
        return $message;
      }
    }
    return FALSE;
  }

  /**
   * Returns an array of date formats.
   *
   * @return array
   *   key => value array with date_format id => .
   */
  protected function getDateFormats() {
    $date_formats = DateFormat::loadMultiple();
    $formats = [];
    foreach ($date_formats as $id => $date_format) {
      $formats[$id] = \Drupal::service('date.formatter')->format(REQUEST_TIME, $id);
    }

    return $formats;
  }

}
