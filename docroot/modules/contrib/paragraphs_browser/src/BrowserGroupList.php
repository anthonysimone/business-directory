<?php
/**
 * Created by PhpStorm.
 * User: mike
 * Date: 9/29/16
 * Time: 8:42 AM
 */

namespace Drupal\paragraphs_browser;


class BrowserGroupList {
  protected $groups = array();

  public function getGroups() {
    return $this->groups;
  }

  public function getDisplayGroups() {
    $groups = $this->groups;
    $groups['_na'] = new BrowserGroupItem('_na', 'Other');
    return $groups;
  }

  public function setGroups($groups) {
    foreach($groups as $group) {
      if($group instanceof BrowserGroupItem) {
        $this->setGroup($group);
      }
    }
  }

  public function getGroup($id) {
    return isset($this->groups[$id]) ? $this->groups[$id] : null;
  }

  public function setGroup(BrowserGroupItem $group) {
    $this->groups[$group->getId()] = $group;
  }

  /**
   * Adds group to end of groups list, resets weight to heaviest.
   *
   * @param \Drupal\paragraphs_browser\BrowserGroupItem $group
   */
  public function addGroup($machine_name, $label, $weight = null) {
    if(is_null($weight)) {
      $weight = ($last_group = $this->getLastGroup()) ? $last_group->getWeight() + 1 : 0;
    }
    $this->groups[$machine_name] = new BrowserGroupItem($machine_name, $label, $weight);
    return $this->groups[$machine_name];
  }

  public function removeGroup($id) {
    unset($this->groups[$id]);
  }

  public function getLastGroup() {
    foreach($this->getGroups() as $group) {
      if(!isset($weight)) {
        $weight = $group->getWeight();
        $last = $group;
      }
      elseif ($group->getWeight() > $weight) {
        $weight = $group->getWeight();
        $last = $group;
      }
    }
    return isset($last) ? $last : null;
  }
}