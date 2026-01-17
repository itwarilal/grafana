import {
  getTimeZone,
  InterpolateFunction,
  LinkModel,
  locationUtil,
  PanelMenuItem,
  PanelPlugin,
  PluginExtensionLink,
  PluginExtensionPanelContext,
  PluginExtensionPoints,
  PluginExtensionTypes,
  urlUtil,
} from '@grafana/data';
import { t } from '@grafana/i18n';
import { config, locationService } from '@grafana/runtime';
import { LocalValueVariable, sceneGraph, VizPanel, VizPanelMenu } from '@grafana/scenes';
import { DataQuery, OptionsWithLegend } from '@grafana/schema';
import { appEvents } from 'app/core/app_events';
import { createErrorNotification } from 'app/core/copy/appNotification';
import { notifyApp } from 'app/core/reducers/appNotification';
import { contextSrv } from 'app/core/services/context_srv';
import { getMessageFromError } from 'app/core/utils/errors';
import { getCreateAlertInMenuAvailability } from 'app/features/alerting/unified/utils/access-control';
import { scenesPanelToRuleFormValues } from 'app/features/alerting/unified/utils/rule-form';
import { getTrackingSource, shareDashboardType } from 'app/features/dashboard/components/ShareModal/utils';
import { InspectTab } from 'app/features/inspector/types';
import { getScenePanelLinksSupplier } from 'app/features/panel/panellinks/linkSuppliers';
import { createPluginExtensionsGetter } from 'app/features/plugins/extensions/getPluginExtensions';
import { pluginExtensionRegistries } from 'app/features/plugins/extensions/registry/setup';
import { GetPluginExtensions } from 'app/features/plugins/extensions/types';
import { createExtensionSubMenu } from 'app/features/plugins/extensions/utils';
import { dispatch } from 'app/store/store';
import { AccessControlAction } from 'app/types/accessControl';
import { ShowConfirmModalEvent } from 'app/types/events';

import { PanelInspectDrawer } from '../inspect/PanelInspectDrawer';
import { ShareDrawer } from '../sharing/ShareDrawer/ShareDrawer';
import { isRepeatCloneOrChildOf } from '../utils/clone';
import { DashboardInteractions } from '../utils/interactions';
import { getEditPanelUrl, tryGetExploreUrlForPanel } from '../utils/urlBuilders';
import { getDashboardSceneFor, getPanelIdForVizPanel, getQueryRunnerFor, isLibraryPanel } from '../utils/utils';

import { DashboardScene } from './DashboardScene';
import { VizPanelLinks, VizPanelLinksMenu } from './PanelLinks';
import { UnlinkLibraryPanelModal } from './UnlinkLibraryPanelModal';
import { PanelTimeRangeDrawer } from './panel-timerange/PanelTimeRangeDrawer';

let getPluginExtensions: GetPluginExtensions;

function setupGetPluginExtensions() {
  if (getPluginExtensions) {
    return getPluginExtensions;
  }

  getPluginExtensions = createPluginExtensionsGetter(pluginExtensionRegistries);

  return getPluginExtensions;
}

// Define the category for metrics drilldown links
const METRICS_DRILLDOWN_CATEGORY = 'metrics-drilldown';

/**
 * Behavior is called when VizPanelMenu is activated (ie when it's opened).
 */
export function panelMenuBehavior(menu: VizPanelMenu) {
  const asyncFunc = async () => {
    // hm.. add another generic param to SceneObject to specify parent type?
    // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
    const panel = menu.parent as VizPanel;
    const plugin = panel.getPlugin();

    const items: PanelMenuItem[] = [];
    const moreSubMenu: PanelMenuItem[] = [];
    const dashboard = getDashboardSceneFor(panel);
    const { isEmbedded } = dashboard.state.meta;
    const exploreMenuItem = await getExploreMenuItem(panel);
    const isReadOnlyRepeat = isRepeatCloneOrChildOf(panel);

    // For embedded dashboards we only have explore action for now
    if (isEmbedded) {
      if (exploreMenuItem) {
        menu.setState({ items: [exploreMenuItem] });
      }
      return;
    }

    const isEditingPanel = Boolean(dashboard.state.editPanel);
    if (!isEditingPanel) {
      items.push({
        text: t('panel.header-menu.view', `View`),
        iconClassName: 'eye',
        shortcut: 'v',
        href: locationUtil.getUrlForPartial(locationService.getLocation(), {
          viewPanel: panel.getPathId(),
          editPanel: undefined,
        }),
        onClick: () => {
          DashboardInteractions.panelActionClicked('view', getPanelIdForVizPanel(panel), 'panel');
        },
      });
    }

    if (dashboard.canEditDashboard() && dashboard.state.editable && !isReadOnlyRepeat && !isEditingPanel) {
      // We could check isEditing here but I kind of think this should always be in the menu,
      // and going into panel edit should make the dashboard go into edit mode is it's not already
      items.push({
        text: t('panel.header-menu.edit', `Edit`),
        iconClassName: 'edit',
        shortcut: 'e',
        href: getEditPanelUrl(getPanelIdForVizPanel(panel)),
        onClick: () => {
          DashboardInteractions.panelActionClicked('edit', getPanelIdForVizPanel(panel), 'panel');
        },
      });
    }

    const subMenu: PanelMenuItem[] = [];
    subMenu.push({
      text: t('panel.header-menu.share', `Share`),
      iconClassName: 'share-alt',
      shortcut: 'p s',
      onClick: () => {
        DashboardInteractions.panelActionClicked('share', getPanelIdForVizPanel(panel), 'panel');
        dashboard.showModal(new ShareDrawer({ panelRef: panel.getRef() }));
      },
    });

    if (exploreMenuItem) {
      subMenu.push(exploreMenuItem);
    }

    // Inspector
    const inspectorSubMenu: PanelMenuItem[] = [];

    inspectorSubMenu.push({
      text: t('panel.header-menu.inspect-data', `Data`),
      href: locationUtil.getUrlForPartial(locationService.getLocation(), {
        inspect: getPanelIdForVizPanel(panel),
        inspectTab: InspectTab.Data,
      }),
      onClick: () => {
        DashboardInteractions.panelActionClicked(
          'inspect-data',
          getPanelIdForVizPanel(panel),
          'panel-menu-inspect'
        );
        dashboard.showModal(
          new PanelInspectDrawer({
            panelRef: panel.getRef(),
            initialTab: InspectTab.Data,
          })
        );
      },
    });

    inspectorSubMenu.push({
      text: t('panel.header-menu.inspect-query', `Query`),
      href: locationUtil.getUrlForPartial(locationService.getLocation(), {
        inspect: getPanelIdForVizPanel(panel),
        inspectTab: InspectTab.Query,
      }),
      onClick: () => {
        DashboardInteractions.panelActionClicked(
          'inspect-query',
          getPanelIdForVizPanel(panel),
          'panel-menu-inspect'
        );
        dashboard.showModal(
          new PanelInspectDrawer({
            panelRef: panel.getRef(),
            initialTab: InspectTab.Query,
          })
        );
      },
    });

    inspectorSubMenu.push({
      text: t('panel.header-menu.inspect-json', `Panel JSON`),
      href: locationUtil.getUrlForPartial(locationService.getLocation(), {
        inspect: getPanelIdForVizPanel(panel),
        inspectTab: InspectTab.JSON,
      }),
      onClick: () => {
        DashboardInteractions.panelActionClicked(
          'inspect-json',
          getPanelIdForVizPanel(panel),
          'panel-menu-inspect'
        );
        dashboard.showModal(
          new PanelInspectDrawer({
            panelRef: panel.getRef(),
            initialTab: InspectTab.JSON,
          })
        );
      },
    });

    subMenu.push({
      text: t('panel.header-menu.inspect', `Inspect`),
      iconClassName: 'info-circle',
      shortcut: 'i',
      subMenu: inspectorSubMenu,
    });

    // add undock item to main panel menu
    if (dashboard.state.viewPanelScene) {
      items.push({
        text: t('panel.header-menu.view-panel-fullscreen', `Exit fullscreen`),
        iconClassName: 'arrow-left',
        onClick: () => {
          DashboardInteractions.panelActionClicked('view-panel-fullscreen', getPanelIdForVizPanel(panel), 'panel');
          locationService.partial({ viewPanel: null });
        },
      });
    }

    // Add extension point links
    const extensionPointId = PluginExtensionPoints.DashboardPanelMenu;
    const { extensions } = setupGetPluginExtensions()({ extensionPointId });
    const panelQueryRunner = getQueryRunnerFor(panel);
    const context: PluginExtensionPanelContext = {
      id: getPanelIdForVizPanel(panel),
      pluginId: panel.state.pluginId,
      title: panel.state.title,
      timeRange: panelQueryRunner?.state.timeRange,
      timeZone: getTimeZone({
        timeZone: panelQueryRunner?.state.timeZone,
      }),
      dashboard: {
        uid: dashboard.state.uid!,
        title: dashboard.state.title,
        tags: dashboard.state.tags || [],
      },
      targets: (panelQueryRunner?.state.queries as DataQuery[]) || [],
      scopedVars: {
        __sceneObject: { value: panel, text: '__sceneObject' },
      },
    };
    const linkExtensions = extensions
      .filter((extension): extension is PluginExtensionLink => extension.type === PluginExtensionTypes.link)
      .filter((extension) => extension.title && extension.description)
      .slice(0, 3);

    const extensionSubMenu = createExtensionSubMenu({
      extensions: linkExtensions,
      context,
      placement: 'top',
    });

    if (extensionSubMenu.length > 0) {
      subMenu.push(...extensionSubMenu);
    }

    if (panel.state.pluginId === 'piechart') {
      const pieChartDisplayOptions = (panel.state.options as OptionsWithLegend)?.legend?.displayMode;
      if (pieChartDisplayOptions === 'table') {
        moreSubMenu.push({
          text: t('panel.header-menu.pie-chart-to-table', `Convert to table`),
          iconClassName: 'table',
          onClick: () => {
            convertPieChartToTable(panel);
          },
        });
      }
    }

    // More sub menu
    if (dashboard.canEditDashboard() && !isReadOnlyRepeat) {
      moreSubMenu.push({
        text: t('panel.header-menu.duplicate', `Duplicate`),
        iconClassName: 'copy',
        shortcut: 'p d',
        onClick: () => {
          DashboardInteractions.panelActionClicked('duplicate', getPanelIdForVizPanel(panel), 'panel');
          dashboard.duplicatePanel(panel);
        },
      });

      moreSubMenu.push({
        text: t('panel.header-menu.copy', `Copy`),
        iconClassName: 'clipboard-alt',
        onClick: () => {
          DashboardInteractions.panelActionClicked('copy', getPanelIdForVizPanel(panel), 'panel');
          dashboard.copyPanel(panel);
        },
      });
    }

    if (isLibraryPanel(panel)) {
      const unlinkText = t('panel.header-menu.unlink-library-panel', `Unlink library panel`);

      if (dashboard.canEditDashboard()) {
        moreSubMenu.push({
          text: unlinkText,
          iconClassName: 'unlink',
          onClick: () => {
            DashboardInteractions.panelActionClicked('unlink-from-library', getPanelIdForVizPanel(panel), 'panel');
            dashboard.showModal(new UnlinkLibraryPanelModal({ panelRef: panel.getRef() }));
          },
        });
      }
    } else {
      if (contextSrv.hasAccessToExplore() && !(panel.state.pluginId === 'timeseries')) {
        moreSubMenu.push({
          text: t('panel.header-menu.create-library-panel', `Create library panel`),
          iconClassName: 'library-panel',
          onClick: () => {
            DashboardInteractions.panelActionClicked('create-library-panel', getPanelIdForVizPanel(panel), 'panel');
            dashboard.createLibraryPanel(panel);
          },
        });
      }
    }

    // Panel time override
    moreSubMenu.push({
      text: t('panel.header-menu.panel-time-override', `Panel time override`),
      iconClassName: 'clock-nine',
      onClick: () => {
        DashboardInteractions.panelActionClicked('panel-time-override', getPanelIdForVizPanel(panel), 'panel');
        dashboard.showModal(
          new PanelTimeRangeDrawer({
            panelRef: panel.getRef(),
          })
        );
      },
    });

    // Link extensions
    const linksSupplier = getScenePanelLinksSupplier(panel);
    const links = linksSupplier?.getLinks(panel.state.pluginId) ?? [];

    if (links.length > 0) {
      const panelLinksMenu = new VizPanelLinksMenu({
        links: new VizPanelLinks({ rawLinks: links }),
      });

      moreSubMenu.push({
        text: t('panel.header-menu.panel-links', `Panel links`),
        iconClassName: 'external-link-alt',
        subMenu: panelLinksMenu,
      });
    }

    if (!isEditingPanel && dashboard.canEditDashboard() && !isReadOnlyRepeat) {
      // Replace text with icon button and add tooltip
      items.push({
        text: '', // No text, just icon
        iconClassName: 'times', // X icon
        tooltip: t('panel.header-menu.remove-panel', `Remove this panel`),
        onClick: () => {
          DashboardInteractions.panelActionClicked('remove', getPanelIdForVizPanel(panel), 'panel');
          appEvents.publish(
            new ShowConfirmModalEvent({
              title: t('panel.header-menu.remove-panel-title', 'Remove panel'),
              text: t('panel.header-menu.remove-panel-text', 'Are you sure you want to remove this panel?'),
              text2: t('panel.header-menu.remove-panel-text2', 'This action cannot be undone'),
              yesText: t('panel.header-menu.remove-panel-confirm', 'Remove'),
              icon: 'trash-alt',
              onConfirm: () => {
                dashboard.removePanel(panel);
              },
            })
          );
        },
      });
    }

    // Get alert rule create availability
    const availabilityNGAlerting = await getCreateAlertInMenuAvailability({
      datasources: await getDataSources(panel),
      dashboard: {
        uid: dashboard.state.uid!,
        title: dashboard.state.title,
        editable: dashboard.state.editable,
        folderUID: dashboard.state.meta.folderUid,
      },
      panel: {
        id: getPanelIdForVizPanel(panel),
        targets: panelQueryRunner?.state.queries ?? [],
        type: panel.state.pluginId,
        title: panel.state.title,
        pluginVersion: plugin?.meta.info.version ?? '8.0.0', // default plugin version
      },
    });

    if (availabilityNGAlerting.canCreateAlertRule && !isReadOnlyRepeat) {
      moreSubMenu.push({
        text: t('panel.header-menu.new-alert-rule', `New alert rule`),
        iconClassName: 'bell',
        onClick: () => {
          DashboardInteractions.panelActionClicked('create-alert-rule', getPanelIdForVizPanel(panel), 'panel');
          // need to ensure dashboard is saved before directing to alerting
          const onSuccess = () => {
            const ruleFormValues = scenesPanelToRuleFormValues(panel, dashboard);

            locationService.push(
              urlUtil.renderUrl('/alerting/new/alerting', {
                defaults: JSON.stringify(ruleFormValues),
                returnTo: locationService.getLocation().pathname + locationService.getLocation().search,
              })
            );
          };

          const onError = (error: Error) => {
            dispatch(notifyApp(createErrorNotification('Panel not saved', getMessageFromError(error))));
          };

          if (dashboard.state.isDirty) {
            dashboard.onSaveCompleted = onSuccess;
            dashboard.onSaveError = onError;
            dashboard.saveAndUpdate();
          } else {
            onSuccess();
          }
        },
      });
    }

    if (moreSubMenu.length > 0) {
      moreSubMenu.push({
        text: t('panel.header-menu.get-help', `Get help`),
        iconClassName: 'question-circle',
        href: 'https://grafana.com/docs/grafana/latest/panels-visualizations/',
        target: '_blank',
      });

      subMenu.push({
        text: t('panel.header-menu.more', `More...`),
        iconClassName: 'cube',
        subMenu: moreSubMenu,
        tabindex: -1,
      });
    }

    // Combine main items with sub menu items
    items.push(...subMenu);

    menu.setState({ items });
  };

  asyncFunc().catch((err) => {
    console.error('Error in panelMenuBehavior', err);
  });
}

export async function getExploreMenuItem(panel: VizPanel): Promise<PanelMenuItem | undefined> {
  if (!contextSrv.hasAccessToExplore()) {
    return undefined;
  }

  const exploreUrl = await tryGetExploreUrlForPanel(panel);
  if (!exploreUrl) {
    return undefined;
  }

  return {
    text: t('panel.header-menu.explore', `Explore`),
    iconClassName: 'compass',
    shortcut: 'x',
    href: exploreUrl,
    onClick: () => {
      DashboardInteractions.panelActionClicked('explore', getPanelIdForVizPanel(panel), 'panel');
    },
  };
}

async function getDataSources(panel: VizPanel) {
  const queryRunner = getQueryRunnerFor(panel);
  if (!queryRunner) {
    return [];
  }

  const queries = queryRunner.state.queries ?? [];

  const result = [];
  for (const query of queries) {
    if (query.datasource && query.datasource.uid) {
      result.push(query.datasource.uid);
    }
  }

  return [...new Set(result)];
}

function convertPieChartToTable(panel: VizPanel) {
  panel.setState({
    pluginId: 'table',
    options: {
      ...panel.state.options,
      legend: undefined,
    },
    fieldConfig: {
      ...panel.state.fieldConfig,
      defaults: {
        ...panel.state.fieldConfig.defaults,
        custom: {
          ...panel.state.fieldConfig.defaults.custom,
          displayMode: 'auto',
        },
      },
    },
  });

  DashboardInteractions.panelActionClicked('convert-to-table', getPanelIdForVizPanel(panel), 'panel');
}
