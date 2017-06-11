<?php
/**
 * @file
 * Cache logger for Ultimate Cron.
 */

namespace Drupal\ultimate_cron\Plugin\ultimate_cron\Logger;

use Drupal\Core\Form\FormStateInterface;
use Drupal\ultimate_cron\Logger\LogEntry;
use Drupal\ultimate_cron\Logger\LoggerBase;

/**
 * Cache Logger.
 *
 * @LoggerPlugin(
 *   id = "cache",
 *   title = @Translation("Cache"),
 *   description = @Translation("Stores the last log entry (and only the last) in the cache."),
 * )
 */
class CacheLogger extends LoggerBase {

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration() {
    return array(
      'bin' => 'cache_ultimate_cron',
      'timeout' => 0,
    );
  }

  /**
   * {@inheritdoc}
   */
  public function load($name, $lock_id = NULL, array $log_types = [ULTIMATE_CRON_LOG_TYPE_NORMAL]) {
    $log_entry = new $this->logEntryClass($name, $this);

    $job = ultimate_cron_job_load($name);
    $settings = $job->getSettings('logger');

    if (!$lock_id) {
      $cache = cache_get('uc-name:' . $name, $settings['bin']);
      if (empty($cache) || empty($cache->data)) {
        return $log_entry;
      }
      $lock_id = $cache->data;
    }
    $cache = cache_get('uc-lid:' . $lock_id, $settings['bin']);

    if (!empty($cache->data)) {
      $log_entry->setData((array) $cache->data);
      $log_entry->finished = TRUE;
    }
    return $log_entry;
  }

  /**
   * {@inheritdoc}
   */
  public function getLogEntries($name, array $log_types, $limit = 10) {
    $log_entry = $this->load($name);
    return $log_entry->lid ? array($log_entry) : array();
  }

  /**
   * {@inheritdoc}
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state) {
    $form['bin'] = array(
      '#type' => 'textfield',
      '#title' => t('Cache bin'),
      '#description' => t('Select which cache bin to use for storing logs.'),
      '#default_value' => $this->configuration['bin'],
      '#fallback' => TRUE,
      '#required' => TRUE,
    );

    $form['timeout'] = array(
      '#type' => 'textfield',
      '#title' => t('Cache timeout'),
      '#description' => t('Seconds before cache entry expires (0 = never, -1 = on next general cache wipe).'),
      '#default_value' => $this->configuration['timeout'],
      '#fallback' => TRUE,
      '#required' => TRUE,
    );

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function save(LogEntry $log_entry) {
    if (!$log_entry->lid) {
      return;
    }

    if ($log_entry->log_type != ULTIMATE_CRON_LOG_TYPE_NORMAL) {
      return;
    }

    $job = ultimate_cron_job_load($log_entry->name);

    $settings = $job->getSettings('logger');

    $expire = $settings['timeout'] > 0 ? time() + $settings['timeout'] : $settings['timeout'];
    cache_set('uc-name:' . $log_entry->name, $log_entry->lid, $settings['bin'], $expire);
    cache_set('uc-lid:' . $log_entry->lid, $log_entry->getData(), $settings['bin'], $expire);
  }

}
