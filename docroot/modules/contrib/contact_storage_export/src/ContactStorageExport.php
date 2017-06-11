<?php

namespace Drupal\contact_storage_export;

/**
 * Class ContactStorageExport.
 *
 * @package Drupal\contact_storage_export
 */
class ContactStorageExport {

  /**
   * Get the labels from the field definitions.
   *
   * @param array $messages
   *   The contact_message objects.
   *
   * @return array
   *   The labels.
   */
  public static function getLabels($messages) {
    $labels = [];
    if ($fields = reset($messages)->getFieldDefinitions()) {
      foreach ($fields as $key => $field) {
        if ($label = $field->getLabel()) {

          // Remove characters not allowed in keys of associative arrays.
          $label = filter_var(
            $label,
            FILTER_SANITIZE_STRING,
            FILTER_FLAG_STRIP_HIGH | FILTER_FLAG_STRIP_LOW | FILTER_FLAG_NO_ENCODE_QUOTES
          );
          $labels[$key] = $label;

        }
      }
    }
    return $labels;
  }

  /**
   * Get the last id that was exported.
   *
   * @param string $contact_form
   *   The contact form machine name.
   *
   * @return int
   *   The last id exported (or zero if none yet).
   */
  public static function getLastExportId($contact_form) {
    $key = 'contact_storage_export.' . $contact_form;
    return \Drupal::keyValue($key)->get('last_id', 0);
  }

  /**
   * Set the last id that was exported.
   *
   * @param string $contact_form
   *   The contact form machine name.
   * @param int $last_id
   *   The last id exported.
   */
  public static function setLastExportId($contact_form, $last_id) {
    $key = 'contact_storage_export.' . $contact_form;
    \Drupal::keyValue($key)->set('last_id', $last_id);
  }

}
