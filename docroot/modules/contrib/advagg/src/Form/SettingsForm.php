<?php

namespace Drupal\advagg\Form;

use Drupal\Core\Asset\AssetCollectionOptimizerInterface;
use Drupal\Core\Cache\Cache;
use Drupal\Core\Config\ConfigFactoryInterface;
use Drupal\Core\Datetime\DateFormatterInterface;
use Drupal\Core\Extension\ModuleHandlerInterface;
use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;
use Drupal\Core\State\StateInterface;
use Drupal\Core\Url;
use Symfony\Component\DependencyInjection\ContainerInterface;

/**
 * Configure advagg settings for this site.
 */
class SettingsForm extends ConfigFormBase {

  /**
   * The CSS asset collection optimizer service.
   *
   * @var \Drupal\Core\Asset\AssetCollectionOptimizerInterface
   */
  protected $cssCollectionOptimizer;

  /**
   * The JavaScript asset collection optimizer service.
   *
   * @var \Drupal\Core\Asset\AssetCollectionOptimizerInterface
   */
  protected $jsCollectionOptimizer;

  /**
   * The date formatter service.
   *
   * @var \Drupal\Core\Datetime\DateFormatterInterface
   */
  protected $dateFormatter;

  /**
   * The state service.
   *
   * @var \Drupal\Core\State\StateInterface
   */
  protected $state;

  /**
   * Module handler service.
   *
   * @var \Drupal\Core\Extension\ModuleHandlerInterface
   */
  protected $moduleHandler;

  /**
   * Constructs a SettingsForm object.
   *
   * @param \Drupal\Core\Config\ConfigFactoryInterface $config_factory
   *   The factory for configuration objects.
   * @param \Drupal\Core\Asset\AssetCollectionOptimizerInterface $css_collection_optimizer
   *   The CSS asset collection optimizer service.
   * @param \Drupal\Core\Asset\AssetCollectionOptimizerInterface $js_collection_optimizer
   *   The JavaScript asset collection optimizer service.
   * @param \Drupal\Core\Datetime\DateFormatterInterface $date_formatter
   *   The Date formatter service.
   * @param \Drupal\Core\State\StateInterface $state
   *   The state service.
   * @param \Drupal\Core\Extension\ModuleHandlerInterface $module_handler
   *   The module handler service.
   */
  public function __construct(ConfigFactoryInterface $config_factory, AssetCollectionOptimizerInterface $css_collection_optimizer, AssetCollectionOptimizerInterface $js_collection_optimizer, DateFormatterInterface $date_formatter, StateInterface $state, ModuleHandlerInterface $module_handler) {
    parent::__construct($config_factory);

    $this->cssCollectionOptimizer = $css_collection_optimizer;
    $this->jsCollectionOptimizer = $js_collection_optimizer;
    $this->dateFormatter = $date_formatter;
    $this->state = $state;
    $this->moduleHandler = $module_handler;
  }

  /**
   * {@inheritdoc}
   */
  public static function create(ContainerInterface $container) {
    return new static(
      $container->get('config.factory'),
      $container->get('asset.css.collection_optimizer'),
      $container->get('asset.js.collection_optimizer'),
      $container->get('date.formatter'),
      $container->get('state'),
      $container->get('module_handler')
    );
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'advagg_settings';
  }

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return ['advagg.settings', 'system.performance'];
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $config = $this->config('advagg.settings');
    $form = [];
    $form['global'] = [
      '#type' => 'fieldset',
      '#title' => $this->t('Global Options'),
    ];
    $form['global']['enabled'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Enable advanced aggregation'),
      '#default_value' => $config->get('enabled'),
      '#description' => $this->t('Uncheck this box to completely disable AdvAgg functionality.'),
    ];
    $form['global']['core_groups'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Use cores grouping logic'),
      '#default_value' => $config->get('css.combine_media') || $config->get('css.ie.limit_selectors') ? FALSE : $config->get('core_groups'),
      '#description' => $this->t('Will group files just like core does.'),
      '#states' => [
        'enabled' => [
          '#edit-css-combine-media' => ['checked' => FALSE],
          '#edit-css-ie-limit-selectors' => ['checked' => FALSE],
        ],
      ],
    ];
    $form['global']['dns_prefetch'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Use DNS Prefetch for external CSS/JS.'),
      '#default_value' => $config->get('dns_prefetch'),
      '#description' => $this->t('Start the DNS lookup for external CSS and JavaScript files as soon as possible.'),
    ];
    $options = [
      -1 => $this->t('Development'),
      1 => $this->t('Normal'),
      3 => $this->t('High'),
      5 => $this->t('Aggressive'),
    ];

    $form['global']['cache_level'] = [
      '#type' => 'radios',
      '#title' => $this->t('AdvAgg Cache Settings'),
      '#default_value' => $config->get('cache_level'),
      '#options' => $options,
      '#description' => $this->t("No performance data yet but most use cases will probably want to use the Normal cache mode.", [
        '@information' => Url::fromRoute('advagg.info')->toString(),
      ]),
    ];

    $form['global']['dev_container'] = [
      '#type' => 'container',
      '#states' => [
        'visible' => [
          ':input[name="cache_level"]' => ['value' => '-1'],
        ],
      ],
    ];

    // Show msg about advagg css minify.
    if ($this->moduleHandler->moduleExists('advagg_css_minify') && $this->config('advagg_css_minify.settings')->get('advagg_css_minifier') > 0) {
      $form['global']['dev_container']['advagg_css_compress_msg'] = [
        '#markup' => '<p>' . $this->t('The <a href="@css">AdvAgg CSS Minify module</a> is disabled when in development mode.', ['@css' => Url::fromRoute('advagg_css_minify.settings')->toString()]) . '</p>',
      ];

    }

    // Show msg about advagg js minify.
    if ($this->moduleHandler->moduleExists('advagg_js_minify') && $this->config('advagg_js_minify.settings')->get('advagg_js_minifier')) {
      $form['global']['dev_container']['advagg_js_minify_msg'] = [
        '#markup' => '<p>' . $this->t('The <a href="@js">AdvAgg JS Minify module</a> is disabled when in development mode.', ['@js' => Url::fromRoute('advagg_js_minify.settings')->toString()]) . '</p>',
      ];
    }

    $form['global']['cron'] = [
      '#type' => 'details',
      '#title' => $this->t('Cron Options'),
      '#description' => $this->t('Unless you have a good reason to adjust these values you should leave them alone.'),
    ];

    $short_times = [
      900 => $this->t('15 minutes'),
      1800 => $this->t('30 minutes'),
      2700 => $this->t('45 minutes'),
      3600 => $this->t('1 hour'),
      7200 => $this->t('2 hours'),
      14400 => $this->t('4 hours'),
      21600 => $this->t('6 hours'),
      43200 => $this->t('12 hours'),
      64800 => $this->t('18 hours'),
      86400 => $this->t('1 day'),
      172800 => $this->t('2 days'),
    ];

    $long_times = [
      172800 => $this->t('2 days'),
      259200 => $this->t('3 days'),
      345600 => $this->t('4 days'),
      432000 => $this->t('5 days'),
      518400 => $this->t('6 days'),
      604800 => $this->t('1 week'),
      1209600 => $this->t('2 week'),
      1814400 => $this->t('3 week'),
      2592000 => $this->t('1 month'),
      3628800 => $this->t('6 weeks'),
      4838400 => $this->t('2 months'),
    ];
    $last_ran = $this->state->get('advagg.cron_timestamp', NULL);
    if ($last_ran) {
      $last_ran = $this->t('@time ago', ['@time' => $this->dateFormatter->formatInterval(REQUEST_TIME - $last_ran)]);
    }
    else {
      $last_ran = $this->t('never');
    }
    $form['global']['cron']['cron_frequency'] = [
      '#type' => 'select',
      '#options' => $short_times,
      '#title' => 'Minimum amount of time between advagg_cron() runs.',
      '#default_value' => $config->get('cron_frequency'),
      '#description' => $this->t('The default value for this is %value. The last time advagg_cron was ran is %time.', [
        '%value' => $this->dateFormatter->formatInterval($config->get('cron_frequency')),
        '%time' => $last_ran,
      ]),
    ];

    $form['global']['cron']['stale_file_threshold'] = [
      '#type' => 'select',
      '#options' => $long_times,
      '#title' => 'Delete aggregates modified more than a set time ago.',
      '#default_value' => $this->config('system.performance')->get('stale_file_threshold'),
      '#description' => $this->t('The default value for this is %value.', [
        '%value' => $this->dateFormatter->formatInterval($this->config('system.performance')->getOriginal('stale_file_threshold')),
      ]),
    ];

    $form['global']['obscure'] = [
      '#type' => 'details',
      '#title' => $this->t('Obscure Options'),
      '#description' => $this->t('Some of the more obscure AdvAgg settings. Odds are you do not need to change anything in here.'),
    ];
    $form['global']['obscure']['css_gzip'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Gzip CSS assets'),
      '#default_value' => $this->config('system.performance')->get('css.gzip'),
      '#description' => $this->t('This should be enabled unless you are experiencing corrupted compressed asset files.'),
    ];
    $form['global']['obscure']['js_gzip'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Gzip JavaScript assets'),
      '#default_value' => $this->config('system.performance')->get('js.gzip'),
      '#description' => $this->t('This should be enabled unless you are experiencing corrupted compressed asset files.'),
    ];
    $form['global']['obscure']['include_base_url'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Include the base_url variable in the hooks hash array.'),
      '#default_value' => $config->get('include_base_url'),
      '#description' => $this->t('If you would like a unique set of aggregates for every permutation of the base_url (current value: %value) then enable this setting. <a href="@issue">Read more</a>.', [
        '%value' => $GLOBALS['base_url'],
        '@issue' => 'https://www.drupal.org/node/2353811',
      ]),
    ];
    $form['global']['obscure']['path_convert_absolute_to_protocol_relative'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Convert absolute paths to be protocol relative paths.'),
      '#default_value' => $config->get('path.convert.absolute_to_protocol_relative'),
      '#description' => $this->t('If the src to a CSS/JS file points starts with http:// or https://, convert it to use a protocol relative path //. Will also convert url() references inside of css files.'),
      '#states' => [
        'enabled' => [
          '#edit-path-convert-force-https' => ['checked' => FALSE],
        ],
      ],
    ];
    $form['global']['obscure']['path_convert_force_https'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Convert http:// to https://.'),
      '#default_value' => $config->get('path.convert.force_https'),
      '#description' => $this->t('If the src to a CSS/JS file starts with http:// convert it https://. Will also convert url() references inside of css files.'),
      '#states' => [
        'enabled' => [
          '#edit-path-convert-absolut-to-protocol-relative' => ['checked' => FALSE],
        ],
      ],
    ];

    $form['css'] = [
      '#type' => 'details',
      '#title' => $this->t('CSS Options'),
      '#open' => TRUE,
    ];
    $form['css']['css_combine_media'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Combine CSS files by using media queries'),
      '#default_value' => $config->get('css.combine_media'),
      '#description' => $this->t('Will combine more CSS files together because different CSS media types can be used in the same file by using media queries. Use cores grouping logic needs to be unchecked in order for this to work. Also noted is that due to an issue with IE9, compatibility mode is forced off if this is enabled.'),
      '#states' => [
        'disabled' => [
          '#edit-core-groups' => ['checked' => TRUE],
        ],
      ],
    ];
    $form['css']['css_ie_limit_selectors'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Prevent more than %limit CSS selectors in an aggregated CSS file', ['%limit' => $config->get('css.ie.selector_limit')]),
      '#default_value' => $config->get('css.ie.limit_selectors'),
      '#description' => $this->t('Internet Explorer before version 10; IE9, IE8, IE7, and IE6 all have 4095 as the limit for the maximum number of css selectors that can be in a file. Enabling this will prevent CSS aggregates from being created that exceed this limit. <a href="@link">More info</a>. Use cores grouping logic needs to be unchecked in order for this to work.', ['@link' => 'http://blogs.msdn.com/b/ieinternals/archive/2011/05/14/10164546.aspx']),
      '#states' => [
        'disabled' => [
          '#edit-core-groups' => ['checked' => TRUE],
        ],
      ],
    ];
    $form['css']['css_ie_selector_limit'] = [
      '#type' => 'textfield',
      '#title' => $this->t('The selector count the IE CSS limiter should use'),
      '#default_value' => $config->get('css.ie.selector_limit'),
      '#description' => $this->t('Internet Explorer before version 10; IE9, IE8, IE7, and IE6 all have 4095 as the limit for the maximum number of css selectors that can be in a file. Use this field to modify the value used; 4095 sometimes may be still be too many with media queries.'),
      '#states' => [
        'visible' => [
          '#edit-css-ie-limit-selectors' => ['checked' => TRUE],
        ],
        'disabled' => [
          '#edit-css-ie-limit-selectors' => ['checked' => FALSE],
        ],
      ],
    ];
    $form['css']['css_fix_type'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Fix improperly set type'),
      '#default_value' => $config->get('css.fix_type'),
      '#description' => $this->t('If type is external but does not start with http, https, or // change it to be type file. If type is file but it starts with http, https, or // change type to be external. Note that if this is causing issues, odds are you have a double slash when there should be a single; see <a href="@link">this issue</a>', [
        '@link' => 'https://www.drupal.org/node/2336217',
      ]),
    ];

    $form['js'] = [
      '#type' => 'details',
      '#title' => $this->t('JS Options'),
      '#open' => TRUE,
    ];
    $form['js']['js_fix_type'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Fix improperly set type'),
      '#default_value' => $config->get('js_fix_type'),
      '#description' => $this->t('If type is external but does not start with http, https, or // change it to be type file. If type is file but it starts with http, https, or // change type to be external. Note that if this is causing issues, odds are you have a double slash when there should be a single; see <a href="@link">this issue</a>', [
        '@link' => 'https://www.drupal.org/node/2336217',
      ]),
    ];
    $form['js']['js_preserve_external'] = [
      '#type' => 'checkbox',
      '#title' => $this->t('Do not change external to file if on same host.'),
      '#default_value' => $config->get('js_preserve_external'),
      '#description' => $this->t('If a JS file is set as external and is on the same hosts do not convert to file.'),
      '#states' => [
        'disabled' => [
          '#edit-js-fix-type' => ['checked' => FALSE],
        ],
      ],
    ];
    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    $this->config('advagg.settings')
      ->set('css.fix_type', $form_state->getValue('css_fix_type'))
      ->set('css.ie.limit_selectors', $form_state->getValue('css_ie_limit_selectors'))
      ->set('css.ie.selector_limit', $form_state->getValue('css_ie_selector_limit'))
      ->set('css.combine_media', $form_state->getValue('css_combine_media'))
      ->set('path.convert.force_https', $form_state->getValue('path_convert_force_https'))
      ->set('path.convert.absolute_to_protocol_relative', $form_state->getValue('path_convert_absolute_to_protocol_relative'))
      ->set('enabled', $form_state->getValue('enabled'))
      ->set('core_groups', $form_state->getValue('core_groups'))
      ->set('dns_prefetch', $form_state->getValue('dns_prefetch'))
      ->set('cache_level', $form_state->getValue('cache_level'))
      ->set('cron_frequency', $form_state->getValue('cron_frequency'))
      ->set('include_base_url', $form_state->getValue('include_base_url'))
      ->set('js_fix_type', $form_state->getValue('js_fix_type'))
      ->set('js_preserve_external', $form_state->getValue('js_preserve_external'))
      ->save();
    $this->config('system.performance')
      ->set('stale_file_threshold', $form_state->getValue('stale_file_threshold'))
      ->set('css.gzip', $form_state->getValue('css_gzip'))
      ->set('js.gzip', $form_state->getValue('js_gzip'))
      ->save();

    // Clear relevant caches.
    $this->cssCollectionOptimizer->deleteAll();
    $this->jsCollectionOptimizer->deleteAll();
    Cache::invalidateTags(['library_info', 'advagg_css', 'advagg_js']);

    parent::submitForm($form, $form_state);
  }

}
