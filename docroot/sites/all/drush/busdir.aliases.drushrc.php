<?php

$drush_major_version = 8;

if (!isset($drush_major_version)) {
  $drush_version_components = explode('.', DRUSH_VERSION);
  $drush_major_version = $drush_version_components[0];
}
// Site paragon, environment dev
$aliases['dev'] = array(
  'root' => '/var/www/html/paragon.dev/docroot',
  'ac-site' => 'paragon',
  'ac-env' => 'dev',
  'ac-realm' => 'devcloud',
  'uri' => 'paragonbhybefranz.devcloud.acquia-sites.com',
  'remote-host' => 'free-6157.devcloud.hosting.acquia.com',
  'remote-user' => 'paragon.dev',
  'path-aliases' => array(
    '%drush-script' => 'drush' . $drush_major_version,
  )
);
$aliases['dev.livedev'] = array(
  'parent' => '@paragon.dev',
  'root' => '/mnt/gfs/paragon.dev/livedev/docroot',
);

if (!isset($drush_major_version)) {
  $drush_version_components = explode('.', DRUSH_VERSION);
  $drush_major_version = $drush_version_components[0];
}
// Site paragon, environment test
$aliases['test'] = array(
  'root' => '/var/www/html/paragon.test/docroot',
  'ac-site' => 'paragon',
  'ac-env' => 'test',
  'ac-realm' => 'devcloud',
  'uri' => 'paragono6pncnthxe.devcloud.acquia-sites.com',
  'remote-host' => 'free-6157.devcloud.hosting.acquia.com',
  'remote-user' => 'paragon.test',
  'path-aliases' => array(
    '%drush-script' => 'drush' . $drush_major_version,
  )
);
$aliases['test.livedev'] = array(
  'parent' => '@paragon.test',
  'root' => '/mnt/gfs/paragon.test/livedev/docroot',
);
