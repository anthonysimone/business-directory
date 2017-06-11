<?php

namespace Drupal\ultimate_cron\Plugin\ultimate_cron\Logger;

use Drupal\Core\Database\Connection;
use Drupal\Core\Database\Database;
use Drupal\Core\Database\DatabaseException;
use Drupal\Core\Database\IntegrityConstraintViolationException;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\Logger\RfcLogLevel;
use Drupal\Core\Plugin\ContainerFactoryPluginInterface;
use Drupal\ultimate_cron\CronJobInterface;
use Drupal\ultimate_cron\Entity\CronJob;
use Drupal\ultimate_cron\Logger\LogEntry;
use Drupal\ultimate_cron\Logger\LoggerBase;
use Drupal\ultimate_cron\PluginCleanupInterface;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Database logger.
 *
 * @LoggerPlugin(
 *   id = "database",
 *   title = @Translation("Database"),
 *   description = @Translation("Stores logs in the database."),
 *   default = TRUE,
 * )
 */
class DatabaseLogger extends LoggerBase implements PluginCleanupInterface, ContainerFactoryPluginInterface {
  public $options = array();

  const CLEANUP_METHOD_DISABLED = 1;
  const CLEANUP_METHOD_EXPIRE = 2;
  const CLEANUP_METHOD_RETAIN = 3;

  /**
   * @var \Drupal\Core\Database\Connection
   */
  protected $connection;

  /**
   * Constructor.
   */
  public function __construct(array $configuration, $plugin_id, $plugin_definition, Connection $connection) {
    parent::__construct($configuration, $plugin_id, $plugin_definition);

    $this->connection = $connection;

    $this->options['method'] = array(
      static::CLEANUP_METHOD_DISABLED => t('Disabled'),
      static::CLEANUP_METHOD_EXPIRE => t('Remove logs older than a specified age'),
      static::CLEANUP_METHOD_RETAIN => t('Retain only a specific amount of log entries'),
    );
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container, array $configuration, $plugin_id, $plugin_definition) {
    return new static ($configuration, $plugin_id, $plugin_definition, $container->get('database'));
  }
  

  /**
   * {@inheritdoc}
   */
  public function defaultConfiguration() {
    return array(
      'method' => static::CLEANUP_METHOD_RETAIN,
      'expire' => 86400 * 14,
      'retain' => 1000,
    );
  }

  /**
   * {@inheritdoc}
   */
  public function cleanup() {
    $jobs = CronJob::loadMultiple();
    $current = 1;
    $max = 0;
    foreach ($jobs as $job) {
      if ($job->getLoggerId() === $this->getPluginId()) {
        $max++;
      }
    }
    foreach ($jobs as $job) {
      if ($job->getLoggerId() === $this->getPluginId()) {
        // Get the plugin through the job so it has the right configuration.
        $job->getPlugin('logger')->cleanupJob($job);
        $class = \Drupal::entityTypeManager()->getDefinition('ultimate_cron_job')->getClass();
        if ($class::$currentJob) {
          $class::$currentJob->setProgress($current / $max);
          $current++;
        }
      }
    }
  }

  /**
   * {@inheritdoc}
   */
  public function cleanupJob(CronJobInterface $job) {
    switch ($this->configuration['method']) {
      case static::CLEANUP_METHOD_DISABLED:
        return;

      case static::CLEANUP_METHOD_EXPIRE:
        $expire = $this->configuration['expire'];
        // Let's not delete more than ONE BILLION log entries :-o.
        $max = 10000000000;
        $chunk = 100;
        break;

      case static::CLEANUP_METHOD_RETAIN:
        $expire = 0;
        $max = $this->connection->query("SELECT COUNT(lid) FROM {ultimate_cron_log} WHERE name = :name", array(
          ':name' => $job->id(),
        ))->fetchField();
        $max -= $this->configuration['retain'];
        if ($max <= 0) {
          return;
        }
        $chunk = min($max, 100);
        break;

      default:
        \Drupal::logger('ultimate_cron')->warning('Invalid cleanup method: @method', array(
          '@method' => $this->configuration['method'],
        ));
        return;
    }

    // Chunked delete.
    $count = 0;
    do {
      $lids = $this->connection->select('ultimate_cron_log', 'l')
        ->fields('l', array('lid'))
        ->condition('l.name', $job->id())
        ->condition('l.start_time', microtime(TRUE) - $expire, '<')
        ->range(0, $chunk)
        ->orderBy('l.start_time', 'ASC')
        ->orderBy('l.end_time', 'ASC')
        ->execute()
        ->fetchCol();
      if ($lids) {
        $count += count($lids);
        $max -= count($lids);
        $chunk = min($max, 100);
        $this->connection->delete('ultimate_cron_log')
          ->condition('lid', $lids, 'IN')
          ->execute();
      }
    } while ($lids && $max > 0);
    if ($count) {
      \Drupal::logger('database_logger')->info('@count log entries removed for job @name', array(
        '@count' => $count,
        '@name' => $job->id(),
      ));
    }
  }

  /**
   * {@inheritdoc}
   */
  public function settingsLabel($name, $value) {
    switch ($name) {
      case 'method':
        return $this->options[$name][$value];
    }
    return parent::settingsLabel($name, $value);

  }

  /**
   * Settings form.
   */
  public function buildConfigurationForm(array $form, FormStateInterface $form_state) {
    $form['method'] = array(
      '#type' => 'select',
      '#title' => t('Log entry cleanup method'),
      '#description' => t('Select which method to use for cleaning up logs.'),
      '#options' => $this->options['method'],
      '#default_value' => $this->configuration['method'],
    );

    $form['expire'] = array(
      '#type' => 'textfield',
      '#title' => t('Log entry expiration'),
      '#description' => t('Remove log entries older than X seconds.'),
      '#default_value' => $this->configuration['expire'],
      '#fallback' => TRUE,
      '#states' => array(
        'visible' => array(
          ':input[name="logger[settings][method]"]' => array('value' => static::CLEANUP_METHOD_EXPIRE),
        ),
        'required' => array(
          ':input[name="logger[settings][method]"]' => array('value' => static::CLEANUP_METHOD_EXPIRE),
        ),
      ),
    );

    $form['retain'] = array(
      '#type' => 'textfield',
      '#title' => t('Retain logs'),
      '#description' => t('Retain X amount of log entries.'),
      '#default_value' => $this->configuration['retain'],
      '#fallback' => TRUE,
      '#states' => array(
        'visible' => array(
          ':input[name="logger[settings][method]"]' => array('value' => static::CLEANUP_METHOD_RETAIN),
        ),
        'required' => array(
          ':input[name="logger[settings][method]"]' => array('value' => static::CLEANUP_METHOD_RETAIN),
        ),
      ),
    );

    return $form;
  }

  /**
   * {@inheritdoc}
   */
  public function load($name, $lock_id = NULL, array $log_types = [ULTIMATE_CRON_LOG_TYPE_NORMAL]) {
    if ($lock_id) {
      $log_entry = $this->connection->select('ultimate_cron_log', 'l')
        ->fields('l')
        ->condition('l.lid', $lock_id)
        ->execute()
        ->fetchObject($this->logEntryClass, array($name, $this));
    }
    else {
      $log_entry = $this->connection->select('ultimate_cron_log', 'l')
        ->fields('l')
        ->condition('l.name', $name)
        ->condition('l.log_type', $log_types, 'IN')
        ->orderBy('l.start_time', 'DESC')
        ->orderBy('l.end_time', 'DESC')
        ->range(0, 1)
        ->execute()
        ->fetchObject($this->logEntryClass, array($name, $this));
    }
    if ($log_entry) {
      $log_entry->finished = TRUE;
    }
    else {
      $log_entry = new LogEntry($name, $this);
    }
    return $log_entry;
  }

  /**
   * {@inheritdoc}
   */
  public function loadLatestLogEntries(array $jobs, array $log_types) {
    if ($this->connection->databaseType() !== 'mysql') {
      return parent::loadLatestLogEntries($jobs, $log_types);
    }

    $result = $this->connection->query("SELECT l.*
    FROM {ultimate_cron_log} l
    JOIN (
      SELECT l3.name, (
        SELECT l4.lid
        FROM {ultimate_cron_log} l4
        WHERE l4.name = l3.name
        AND l4.log_type IN (:log_types)
        ORDER BY l4.name desc, l4.start_time DESC
        LIMIT 1
      ) AS lid FROM {ultimate_cron_log} l3
      GROUP BY l3.name
    ) l2 on l2.lid = l.lid", array(':log_types' => $log_types));

    $log_entries = array();
    while ($object = $result->fetchObject()) {
      if (isset($jobs[$object->name])) {
        $log_entries[$object->name] = new $this->logEntryClass($object->name, $this);
        $log_entries[$object->name]->setData((array) $object);
      }
    }
    foreach ($jobs as $name => $job) {
      if (!isset($log_entries[$name])) {
        $log_entries[$name] = new $this->logEntryClass($name, $this);
      }
    }

    return $log_entries;
  }

  /**
   * {@inheritdoc}
   */
  public function getLogEntries($name, array $log_types, $limit = 10) {
    $result = $this->connection->select('ultimate_cron_log', 'l')
      ->fields('l')
      ->extend('Drupal\Core\Database\Query\PagerSelectExtender')
      ->condition('l.name', $name)
      ->condition('l.log_type', $log_types, 'IN')
      ->limit($limit)
      ->orderBy('l.start_time', 'DESC')
      ->execute();

    $log_entries = array();
    while ($object = $result->fetchObject($this->logEntryClass, array(
      $name,
      $this
    ))) {
      $log_entries[$object->lid] = $object;
    }

    return $log_entries;
  }

  /**
   * Save log entry.
   */
  public function save(LogEntry $log_entry) {
    if (!$log_entry->lid) {
      return;
    }

    try {
      $this->connection->insert('ultimate_cron_log')
        ->fields([
          'lid' => $log_entry->lid,
          'name' => $log_entry->name,
          'log_type' => $log_entry->log_type,
          'start_time' => $log_entry->start_time,
          'end_time' => $log_entry->end_time,
          'uid' => $log_entry->uid,
          'init_message' => $log_entry->init_message,
          'message' => $log_entry->message,
          'severity' => $log_entry->severity,
        ])
        ->execute();
    }
    catch (IntegrityConstraintViolationException $e) {
      // Row already exists. Let's update it, if we can.
      $updated = $this->connection->update('ultimate_cron_log')
        ->fields([
          'name' => $log_entry->name,
          'log_type' => $log_entry->log_type,
          'start_time' => $log_entry->start_time,
          'end_time' => $log_entry->end_time,
          'init_message' => $log_entry->init_message,
          'message' => $log_entry->message,
          'severity' => $log_entry->severity,
        ])
        ->condition('lid', $log_entry->lid)
        ->condition('end_time', 0)
        ->execute();
      if (!$updated) {
        // Row was not updated, someone must have beaten us to it.
        // Let's create a new log entry.
        $lid = $log_entry->lid . '-' . uniqid('', TRUE);
        $log_entry->message = t('Lock #@original_lid was already closed and logged. Creating a new log entry #@lid', [
            '@original_lid' => $log_entry->lid,
            '@lid' => $lid,
          ]) . "\n" . $log_entry->message;
        $log_entry->severity = $log_entry->severity >= 0 && $log_entry->severity < RfcLogLevel::ERROR ? $log_entry->severity : RfcLogLevel::ERROR;
        $log_entry->lid = $lid;

        $this->save($log_entry);
      }
    }
    catch (\Exception $e) {
      // In case the insert statement above results in a database exception.
      // To ensure that the causal error is written to the log,
      // we try once to open a dedicated connection and write again.
      if (
        // Only handle database related exceptions.
        ($e instanceof DatabaseException || $e instanceof \PDOException) &&
        // Avoid an endless loop of re-write attempts.
        $this->connection->getTarget() != 'ultimate_cron' &&
        !\Drupal::config('ultimate_cron')->get('bypass_transactional_safe_connection')
      ) {

        $key = $this->connection->getKey();
        $info = Database::getConnectionInfo($key);
        Database::addConnectionInfo($key, 'ultimate_cron', $info['default']);
        $this->connection = Database::getConnection('ultimate_cron', $key);

        // Now try once to log the error again.
        $this->save($log_entry);
      }
      else {
        throw $e;
      }
    }
  }

}
