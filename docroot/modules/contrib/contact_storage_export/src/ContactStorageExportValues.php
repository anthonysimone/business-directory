<?php

namespace Drupal\contact_storage_export;

/**
 * Class ContactStorageExportValues.
 *
 * @package Drupal\contact_storage_export
 */
class ContactStorageExportValues {

  /**
   * Flatten an array when there is only 1 item in the array.
   *
   * @param mixed $value
   *   A value from the contact message.
   *
   * @return mixed
   *   The value as flattened as possible without data loss.
   */
  public static function flattenValue($value) {
    if (is_array($value)) {
      $value = array_filter($value);

      if (count($value) == 1) {

        // If number of values is one, flatten it fully.
        $value = reset($value);
        $value = self::flattenValue($value);
      }
      elseif (count($value) > 1) {

        // If number of values is greater than one, we need to prepare
        // it further.
        $value = self::preventMixedValues($value);
      }
      elseif (count($value) == 0) {

        // If no array values, flatten completely by returning empty string.
        $value = '';
      }
    }

    return $value;
  }

  /**
   * Avoid CSV Serialization warnings.
   *
   * CSV Serialization throws warnings if an array is mixed with strings
   * and arrays. Let's avoid that.
   *
   * @param array $value
   *   The array with potentially mixed values.
   *
   * @return array
   *   The consistent array.
   */
  private static function preventMixedValues($value) {
    $non_arrays = [];
    $arrays = [];

    // Check if there is a mix of arrays and non arrays.
    foreach ($value as $key => $val) {
      if (is_array($val)) {
        $arrays[] = $key;
      }
      else {
        $non_arrays[] = $key;
      }
    }

    // If we have a mix, fix it.
    if ($arrays && $non_arrays) {
      $value = self::fixMixedValues($value, $arrays);
    }
    return $value;
  }

  /**
   * Fix the mixed values by flattening the arrays.
   *
   * @param array $value
   *   The array of mixed values.
   * @param array $keys
   *   The keys for the arrays within the value.
   *
   * @return array
   *   The array of flat values.
   */
  private static function fixMixedValues($value, $keys) {
    foreach ($keys as $key) {
      if (count($value[$key]) == 0) {

        // If we have no array values, make an empty string for export.
        $value[$key] = '';

      }
      elseif (count($value[$key]) == 1) {

        // If we have one array value, make it a string.
        $value[$key] = reset($value[$key]);

      }
      else {

        // Serialise the data.
        $value[$key] = serialize($value[$key]);

      }
    }
    return $value;
  }

}
