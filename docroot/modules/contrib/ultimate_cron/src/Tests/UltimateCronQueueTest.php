<?php

/**
 * @file
 * Contains \Drupal\ultimate_cron\Tests\UltimateCronQueueTest.
 *
 * Test that queues are processed on cron using the System module.
 */

namespace Drupal\ultimate_cron\Tests;

use Drupal\system\Tests\System\CronQueueTest;
use Drupal\ultimate_cron\CronJobInterface;
use Drupal\ultimate_cron\Entity\CronJob;

/**
 * Update feeds on cron.
 *
 * @group ultimate_cron
 */
class UltimateCronQueueTest extends CronQueueTest {

  /**
   * Modules to enable.
   *
   * @var array
   */
  public static $modules = array('ultimate_cron');

  /**
   * Tests behavior when ultimate_cron overrides the cron processing.
   */
  public function testOverriddenProcessing() {

    $job = CronJob::load(CronJobInterface::QUEUE_ID_PREFIX . 'cron_queue_test_broken_queue');
    $this->assertNull($job);

    $this->config('ultimate_cron.settings')
      ->set('queue.enabled', TRUE)
      ->save();

    \Drupal::service('ultimate_cron.discovery')->discoverCronJobs();

    $job = CronJob::load(CronJobInterface::QUEUE_ID_PREFIX . 'cron_queue_test_broken_queue');
    $this->assertTrue($job instanceof CronJobInterface);

    /** @var \Drupal\Core\Queue\QueueInterface $queue */
    $queue = $this->container->get('queue')->get('cron_queue_test_broken_queue');

    // Enqueue several item for processing.
    $queue->createItem('process');
    $queue->createItem('process');
    $queue->createItem('process');
    $this->assertEqual(3, $queue->numberOfItems());

    // Run the job, this should process them.
    $job->run();
    $this->assertEqual(0, $queue->numberOfItems());

    // Check item delay feature.
    $this->config('ultimate_cron.settings')
      ->set('queue.delays.item_delay', 0.5)
      ->save();

    $queue->createItem('process');
    $queue->createItem('process');
    $queue->createItem('process');
    $this->assertEqual(3, $queue->numberOfItems());

    // There are 3 items, the implementation doesn't wait for the first, that
    // means this should between 1 and 1.5 seconds.
    $before = microtime(TRUE);
    $job->run();
    $after = microtime(TRUE);

    $this->assertEqual(0, $queue->numberOfItems());
    $this->assertTrue($after - $before > 1);
    $this->assertTrue($after - $after < 1.5);

    // @todo Test empty delay, causes a wait of 60 seconds with the test queue
    //   worker.
  }

}
