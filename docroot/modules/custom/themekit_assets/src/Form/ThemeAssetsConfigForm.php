<?php

namespace Drupal\themekit_assets\Form;

use Drupal\Core\Form\ConfigFormBase;
use Drupal\Core\Form\FormStateInterface;

/**
 * Class ThemeAssetsConfigForm.
 *
 * @package Drupal\themekit_assets\Form
 */
class ThemeAssetsConfigForm extends ConfigFormBase {

  /**
   * {@inheritdoc}
   */
  protected function getEditableConfigNames() {
    return [
      'themekit_assets.settings',
    ];
  }

  /**
   * {@inheritdoc}
   */
  public function getFormId() {
    return 'theme_assets_config_form';
  }

  /**
   * {@inheritdoc}
   */
  public function buildForm(array $form, FormStateInterface $form_state) {
    $config = $this->config('themekit_assets.settings');

    $form['themekit_assets']['prod_css'] = array(
      '#type' => 'checkbox',
      '#title' => $this->t('Use production stylesheet'),
      '#default_value' => $config->get('prod_css'),
      '#description' => $this->t('Check this option to use the minified and production optimized version of the theme stylesheet.')
    );

    $form['themekit_assets']['prod_js'] = array(
      '#type' => 'checkbox',
      '#title' => $this->t('Use production javascript'),
      '#default_value' => $config->get('prod_js'),
      '#description' => $this->t('Check this option to use the minified and production optimized version of the theme javascript.')
    );

    $form['themekit_assets']['admin_assets'] = array(
      '#type' => 'checkbox',
      '#title' => $this->t('Add custom admin assets'),
      '#default_value' => $config->get('admin_assets'),
      '#description' => $this->t('Check this option to add a custom stylesheet and javascript to the admin theme.')
    );

    return parent::buildForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function validateForm(array &$form, FormStateInterface $form_state) {
    parent::validateForm($form, $form_state);
  }

  /**
   * {@inheritdoc}
   */
  public function submitForm(array &$form, FormStateInterface $form_state) {
    parent::submitForm($form, $form_state);

    $this->config('themekit_assets.settings')
      ->set('prod_css', $form_state->getValue('prod_css'))
      ->set('prod_js', $form_state->getValue('prod_js'))
      ->set('admin_assets', $form_state->getValue('admin_assets'))
      ->save();
  }

}
