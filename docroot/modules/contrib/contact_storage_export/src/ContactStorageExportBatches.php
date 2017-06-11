<?php

namespace Drupal\contact_storage_export;

use Drupal\csv_serialization\Encoder\CsvEncoder;
use Symfony\Component\HttpFoundation\RedirectResponse;
use Drupal\Core\Url;
use Drupal\contact_storage_export\ContactStorageExportValues;
use Drupal\contact_storage_export\ContactStorageExportTempstore;

/**
 * Class ContactStorageExportBatches.
 *
 * @package Drupal\contact_storage_export
 */
class ContactStorageExportBatches {

  /**
   * Process callback for the batch set the export form.
   *
   * @param array $settings
   *   The settings from the export form.
   * @param array $context
   *   The batch context.
   */
  public static function processBatch($settings, &$context) {
    if (empty($context['sandbox'])) {

      // Store data in results for batch finish.
      $context['results']['data'] = [];
      $context['results']['settings'] = $settings;

      // Whether we are doing since last export.
      $last_id = 0;
      if ($settings['since_last_export']) {
        $last_id = ContactStorageExport::getLastExportId($settings['contact_form']);
      }

      // Set initial batch progress.
      $context['sandbox']['settings'] = $settings;
      $context['sandbox']['progress'] = 0;
      $context['sandbox']['current_id'] = 0;
      $context['sandbox']['max'] = self::getMax($settings, $last_id);

    }
    else {
      $settings = $context['sandbox']['settings'];
    }

    if ($context['sandbox']['max'] == 0) {

      // If we have no rows to export, immediately finish.
      $context['finished'] = 1;

    }
    else {

      // Get the next batch worth of data.
      self::getContactFormData($settings, $context);

      // Check if we are now finished.
      if ($context['sandbox']['progress'] != $context['sandbox']['max']) {
        $context['finished'] = $context['sandbox']['progress'] / $context['sandbox']['max'];
      }

    }

  }

  /**
   * Get the submissions for the given contact form.
   *
   * @param array $settings
   *   The settings from the export form.
   * @param array $context
   *   The batch context.
   */
  private static function getContactFormData($settings, &$context) {
    $last_id = 0;
    if ($settings['since_last_export']) {
      $last_id = ContactStorageExport::getLastExportId($settings['contact_form']);
    }

    $limit = 25;
    $query = \Drupal::entityQuery('contact_message');
    $query->condition('contact_form', $settings['contact_form']);
    $query->condition('id', $last_id, '>');
    $query->range($context['sandbox']['progress'], $limit);
    if ($mids = $query->execute()) {
      if ($messages = entity_load_multiple('contact_message', $mids)) {
        self::prepareMessages($messages, $settings, $context);
      }
    }
  }

  /**
   * Get max amount of messages to export.
   *
   * @param array $settings
   *   The settings from the export form.
   * @param int $last_id
   *   The last id exported or 0 if all.
   *
   * @return int
   *   The maximum number of messages to export.
   */
  private static function getMax($settings, $last_id) {
    $query = \Drupal::entityQuery('contact_message');
    $query->condition('contact_form', $settings['contact_form']);
    $query->condition('id', $last_id, '>');
    $query->count();
    $result = $query->execute();
    return ($result ? $result : 0);
  }

  /**
   * Prepare the contact_message objects for export to CSV.
   *
   * @param array $messages
   *   The contact_message objects.
   * @param array $settings
   *   The settings from the export form.
   * @param array $context
   *   The batch context.
   */
  private static function prepareMessages($messages, $settings, &$context) {

    $labels = ContactStorageExport::getLabels($messages, TRUE);
    $all_keys = array_keys($labels);
    $selected_keys = array_keys($settings['columns']);
    $excluded_keys = array_diff($all_keys, $selected_keys);

    foreach ($messages as $contact_message) {

      $row = [];
      $id = $contact_message->id();

      // Get the message values we want to export.
      $values = $contact_message->toArray();
      $values = self::removeColumns($values, $excluded_keys);

      if (isset($values['created']) && !empty($values['created'])) {
        $values['created'][0]['value'] = \Drupal::service('date.formatter')->format($values['created'][0]['value'], $settings['date_format']);
      }

      foreach ($values as $key => $value) {

        // Set the keys to be readable labels and flatten the data
        // for CSV serialization.
        $row[$labels[$key]] = ContactStorageExportValues::flattenValue($value);

      }

      // Add the row to our CSV data.
      $context['results']['data'][] = $row;
      $context['results']['current_id'] = $id;
      $context['sandbox']['progress']++;
      $context['sandbox']['current_id'] = $id;

      // Set the current message.
      $context['message'] = t('Processed up to Contact Message ID @id. Your file will download immediately when complete.', [
        '@id' => $id,
      ]);

    }
  }

  /**
   * Remove undesired columns from export.
   *
   * @param array $values
   *   The keyed values from the contact_message.
   * @param array $excluded_keys
   *   Column keys to exclude.
   *
   * @return array
   *   The updated keyed values after removals.
   */
  private static function removeColumns($values, $excluded_keys) {
    unset(
      $values['uuid']
    );

    if ($excluded_keys) {
      $values = array_diff_key($values, array_flip($excluded_keys));
    }

    return $values;
  }

  /**
   * Finish callback for the batch set the export form.
   *
   * @param bool $success
   *   Whether the batch was successful or not.
   * @param array $results
   *   The bath results.
   * @param array $operations
   *   The batch operations.
   */
  public static function finishBatch($success, $results, $operations) {
    if ($success) {
      if ($results['data']) {

        // Store last exported ID if requested.
        if ($results['settings']['since_last_export']) {
          ContactStorageExport::setLastExportId($results['settings']['contact_form'], $results['current_id']);
        }

        // Encode the CSV data into a string.
        $encoder = new CsvEncoder();
        $csv_string = $encoder->encode($results['data'], 'csv');
        $filename = addslashes($results['settings']['filename']);

        // Save the data to the tempstore.
        $key = ContactStorageExportTempstore::setTempstore($csv_string, $filename);

        // Redirect to download page.
        $route = 'contact_storage_export.contact_storage_download_form';
        $args = [
          'contact_form' => $results['settings']['contact_form'],
          'key' => $key,
        ];
        $url = Url::fromRoute($route, $args);
        $url_string = $url->toString();
        $response = new RedirectResponse($url_string);
        $response->send();

      }
      else {
        $message = t('There was no data to export.');
        drupal_set_message($message, 'warning');
      }
    }
    else {
      $message = t('The export was unsuccessful for an unknown reason. Please check your error logs.');
      drupal_set_message($message, 'warning');
    }

    // Redirect back to export page.
    $route = 'entity.contact_form.export_form';
    $args = [
      'contact_form' => $results['settings']['contact_form'],
    ];
    $url = Url::fromRoute($route, $args);
    $url_string = $url->toString();
    $response = new RedirectResponse($url_string);
    $response->send();

  }

}
