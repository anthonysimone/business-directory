<?php

namespace Drupal\contact_storage_export;

/**
 * Class ContactStorageExportTempstore.
 *
 * @package Drupal\contact_storage_export
 */
class ContactStorageExportTempstore {

  /**
   * Save the data to the tempstore.
   *
   * @param string $csv_string
   *   Prepared CSV string.
   * @param string $filename
   *   Name of the file to output.
   */
  public static function setTempstore($csv_string, $filename) {
    $tempstore = \Drupal::service('user.private_tempstore')
      ->get('contact_storage_export');

    // Get existing data.
    $data = $tempstore->get('data');

    // Possibly have more than one export running at a time, set unique key.
    $data = [];
    $key = 0;
    if (is_array($data)) {
      $data = self::cleanTempstoreData($data);
      if ($keys = array_keys($data)) {
        $key = (max($keys) + 1);
      }
    }

    // Set data.
    $data[$key] = [
      'created' => time(),
      'csv_string' => $csv_string,
      'filename' => $filename,
    ];

    // Save tempstore.
    $tempstore->set('data', $data);

    return $key;
  }

  /**
   * Prevent overload of data in tempstore, clean up older than 60 min.
   *
   * @param array $data
   *   The current tempstore data.
   *
   * @return array
   *   The cleaned up tempstore data.
   */
  protected static function cleanTempstoreData($data) {
    $delete_if_older_than = strtotime('-60 minutes');
    foreach ($data as $key => $value) {
      if ($value['created'] < $delete_if_older_than) {
        unset($data[$key]);
      }
    }
    return $data;
  }

}
