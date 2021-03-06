<?php

/**
 * Config settings
 * @TODO: Move to the repo root
 */

$config_directories = array(
    CONFIG_SYNC_DIRECTORY => '../config/default',
 );

/**
 * Hash salt used for one-time login links, etc.
 */
$settings['hash_salt'] = 'ZDKkQxVPRT1754DOHetrX86m_pagksVNvImJZsNlGIoto2V5VRBtQeRCnVNWYRFMBwPenG0GgQ';

/**
 * Access control for update.php script.
 */
$settings['update_free_access'] = FALSE;

/**
 * Authorized file system operations.
 */
$settings['allow_authorize_operations'] = FALSE;

/**
 * Default mode for directories and files written by Drupal.
 */
$settings['file_chmod_directory'] = 0775;
$settings['file_chmod_file'] = 0664;

/**
 * Load services definition file.
 */
$settings['container_yamls'][] = __DIR__ . '/services.yml';


$settings['install_profile'] = 'standard';

/**
 * Trusted host configuration.
 *
 * Drupal core can use the Symfony trusted host mechanism to prevent HTTP Host
 * header spoofing.
 *
 * To enable the trusted host mechanism, you enable your allowable hosts
 * in $settings['trusted_host_patterns']. This should be an array of regular
 * expression patterns, without delimiters, representing the hosts you would
 * like to allow.
 *
 * For example:
 * @code
 * $settings['trusted_host_patterns'] = array(
 *   '^www\.example\.com$',
 * );
 * @endcode
 * will allow the site to only run from www.example.com.
 *
 * If you are running multisite, or if you are running your site from
 * different domain names (eg, you don't redirect http://www.example.com to
 * http://example.com), you should specify all of the host patterns that are
 * allowed by your site.
 *
 * For example:
 * @code
 * $settings['trusted_host_patterns'] = array(
 *   '^example\.com$',
 *   '^.+\.example\.com$',
 *   '^example\.org$',
 *   '^.+\.example\.org$',
 * );
 * @endcode
 * will allow the site to run off of all variants of example.com and
 * example.org, with all subdomains included.
 */

// Trusted host patterns for e3develop and e3stanging. Make sure to add appropriate variations for production domain
// and any additional version thereof.
// Additional env specific patterns can be added in the following files (drupalvm, local)
$settings['trusted_host_patterns'] = array(
  '^organyzr\.com$',
  '^.+\.organyzr\.com$',
);

// Set default paths to public, private and temp directories.
$settings['file_public_path'] = 'sites/default/files';
$settings['file_private_path'] = '../private';
$config['system.file']['path']['temporary'] = '../private/tmp';

// Remove shield print message by default.
$config['shield.settings']['print'] = '';

// Allow cli to bypass shield.
$config['shield.settings']['allow_cli'] = TRUE;

// Set logging level default.
$config['system.logging']['error_level'] = 'all';

// Set Google Analytics to NULL, override this for production environment.
$config['google_analytics.settings']['account'] = '';


// Initialize Dotenv with relative path to project root if .env file exists
if (file_exists(__DIR__ . '/../../../.env')) {
  $dotenv = new Dotenv\Dotenv(__DIR__ . '/../../..');
  $dotenv->load();
}

// If $_ENV['FORGE_SITE_ENVIRONMENT'], load Acquia settings.
if(getenv('FORGE_SITE_ENVIRONMENT'))  {
  if (file_exists(__DIR__ . '/settings.forge.php')) {
    include __DIR__ . '/settings.forge.php';
  }
}
// Else, load drupal-vm settings if they exist.
elseif (file_exists(__DIR__ . '/settings.drupalvm.php')) {
  include __DIR__ . '/settings.drupalvm.php';
}
