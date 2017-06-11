<?php

namespace Drupal\advagg\State;

use Drupal\Core\Cache\CacheBackendInterface;
use Drupal\Core\KeyValueStore\KeyValueFactoryInterface;
use Drupal\Core\Lock\LockBackendInterface;
use Drupal\Core\State\StateInterface;

/**
 * Provides AdvAgg with saved aggregrate information using a key value store.
 */
class Aggregates extends State implements StateInterface {

  /**
   * Constructs the State object.
   *
   * @param \Drupal\Core\KeyValueStore\KeyValueFactoryInterface $key_value_factory
   *   The key value store to use.
   * @param \Drupal\Core\Cache\CacheBackendInterface $cache
   *   The cache object to use.
   * @param \Drupal\Core\Lock\LockBackendInterface $lock
   *   The lock object to use.
   */
  public function __construct(KeyValueFactoryInterface $key_value_factory, CacheBackendInterface $cache, LockBackendInterface $lock) {
    parent::__construct($key_value_factory, $cache, $lock);
    $this->keyValueStore = $key_value_factory->get('advagg_aggregates');
    $this->pathColumn = 'uri';
  }

}
