import { Component, OnInit, TemplateRef, ViewChild } from '@angular/core';

import { I18n } from '@ngx-translate/i18n-polyfill';
import * as _ from 'lodash';
import { BsModalRef, BsModalService } from 'ngx-bootstrap/modal';
import { forkJoin as observableForkJoin, Observable } from 'rxjs';

import { OsdService } from '../../../../shared/api/osd.service';
import { ConfirmationModalComponent } from '../../../../shared/components/confirmation-modal/confirmation-modal.component';
import { CriticalConfirmationModalComponent } from '../../../../shared/components/critical-confirmation-modal/critical-confirmation-modal.component';
import { ActionLabelsI18n } from '../../../../shared/constants/app.constants';
import { TableComponent } from '../../../../shared/datatable/table/table.component';
import { CellTemplate } from '../../../../shared/enum/cell-template.enum';
import { Icons } from '../../../../shared/enum/icons.enum';
import { CdTableAction } from '../../../../shared/models/cd-table-action';
import { CdTableColumn } from '../../../../shared/models/cd-table-column';
import { CdTableSelection } from '../../../../shared/models/cd-table-selection';
import { Permissions } from '../../../../shared/models/permissions';
import { DimlessBinaryPipe } from '../../../../shared/pipes/dimless-binary.pipe';
import { AuthStorageService } from '../../../../shared/services/auth-storage.service';
import { URLBuilderService } from '../../../../shared/services/url-builder.service';
import { OsdFlagsModalComponent } from '../osd-flags-modal/osd-flags-modal.component';
import { OsdPgScrubModalComponent } from '../osd-pg-scrub-modal/osd-pg-scrub-modal.component';
import { OsdRecvSpeedModalComponent } from '../osd-recv-speed-modal/osd-recv-speed-modal.component';
import { OsdReweightModalComponent } from '../osd-reweight-modal/osd-reweight-modal.component';
import { OsdScrubModalComponent } from '../osd-scrub-modal/osd-scrub-modal.component';

const BASE_URL = 'osd';

@Component({
  selector: 'cd-osd-list',
  templateUrl: './osd-list.component.html',
  styleUrls: ['./osd-list.component.scss'],
  providers: [{ provide: URLBuilderService, useValue: new URLBuilderService(BASE_URL) }]
})
export class OsdListComponent implements OnInit {
  @ViewChild('statusColor', { static: true })
  statusColor: TemplateRef<any>;
  @ViewChild('osdUsageTpl', { static: true })
  osdUsageTpl: TemplateRef<any>;
  @ViewChild('markOsdConfirmationTpl', { static: true })
  markOsdConfirmationTpl: TemplateRef<any>;
  @ViewChild('criticalConfirmationTpl', { static: true })
  criticalConfirmationTpl: TemplateRef<any>;
  @ViewChild(TableComponent, { static: true })
  tableComponent: TableComponent;
  @ViewChild('reweightBodyTpl', { static: false })
  reweightBodyTpl: TemplateRef<any>;
  @ViewChild('safeToDestroyBodyTpl', { static: false })
  safeToDestroyBodyTpl: TemplateRef<any>;

  permissions: Permissions;
  tableActions: CdTableAction[];
  bsModalRef: BsModalRef;
  columns: CdTableColumn[];
  clusterWideActions: CdTableAction[];
  icons = Icons;

  selection = new CdTableSelection();
  osds = [];

  protected static collectStates(osd) {
    const states = [osd['in'] ? 'in' : 'out'];
    if (osd['up']) {
      states.push('up');
    } else if (osd.state.includes('destroyed')) {
      states.push('destroyed');
    } else {
      states.push('down');
    }
    return states;
  }

  constructor(
    private authStorageService: AuthStorageService,
    private osdService: OsdService,
    private dimlessBinaryPipe: DimlessBinaryPipe,
    private modalService: BsModalService,
    private i18n: I18n,
    private urlBuilder: URLBuilderService,
    public actionLabels: ActionLabelsI18n
  ) {
    this.permissions = this.authStorageService.getPermissions();
    this.tableActions = [
      {
        name: this.actionLabels.CREATE,
        permission: 'create',
        icon: Icons.add,
        routerLink: () => this.urlBuilder.getCreate(),
        canBePrimary: (selection: CdTableSelection) => !selection.hasSelection
      },
      {
        name: this.actionLabels.SCRUB,
        permission: 'update',
        icon: Icons.analyse,
        click: () => this.scrubAction(false),
        disable: () => !this.hasOsdSelected,
        canBePrimary: (selection: CdTableSelection) => selection.hasSelection
      },
      {
        name: this.actionLabels.DEEP_SCRUB,
        permission: 'update',
        icon: Icons.deepCheck,
        click: () => this.scrubAction(true),
        disable: () => !this.hasOsdSelected
      },
      {
        name: this.actionLabels.REWEIGHT,
        permission: 'update',
        click: () => this.reweight(),
        disable: () => !this.hasOsdSelected || !this.selection.hasSingleSelection,
        icon: Icons.reweight
      },
      {
        name: this.actionLabels.MARK_OUT,
        permission: 'update',
        click: () => this.showConfirmationModal(this.i18n('out'), this.osdService.markOut),
        disable: () => this.isNotSelectedOrInState('out'),
        icon: Icons.left
      },
      {
        name: this.actionLabels.MARK_IN,
        permission: 'update',
        click: () => this.showConfirmationModal(this.i18n('in'), this.osdService.markIn),
        disable: () => this.isNotSelectedOrInState('in'),
        icon: Icons.right
      },
      {
        name: this.actionLabels.MARK_DOWN,
        permission: 'update',
        click: () => this.showConfirmationModal(this.i18n('down'), this.osdService.markDown),
        disable: () => this.isNotSelectedOrInState('down'),
        icon: Icons.down
      },
      {
        name: this.actionLabels.MARK_LOST,
        permission: 'delete',
        click: () =>
          this.showCriticalConfirmationModal(
            this.i18n('Mark'),
            this.i18n('OSD lost'),
            this.i18n('marked lost'),
            this.osdService.markLost
          ),
        disable: () => this.isNotSelectedOrInState('up'),
        icon: Icons.flatten
      },
      {
        name: this.actionLabels.PURGE,
        permission: 'delete',
        click: () =>
          this.showCriticalConfirmationModal(
            this.i18n('Purge'),
            this.i18n('OSD'),
            this.i18n('purged'),
            (id) => {
              this.selection = new CdTableSelection();
              return this.osdService.purge(id);
            }
          ),
        disable: () => this.isNotSelectedOrInState('up'),
        icon: Icons.erase
      },
      {
        name: this.actionLabels.DESTROY,
        permission: 'delete',
        click: () =>
          this.showCriticalConfirmationModal(
            this.i18n('destroy'),
            this.i18n('OSD'),
            this.i18n('destroyed'),
            (id) => {
              this.selection = new CdTableSelection();
              return this.osdService.destroy(id);
            }
          ),
        disable: () => this.isNotSelectedOrInState('up'),
        icon: Icons.destroy
      }
    ];
  }

  ngOnInit() {
    this.clusterWideActions = [
      {
        name: this.i18n('Flags'),
        icon: Icons.flag,
        click: () => this.configureFlagsAction(),
        permission: 'read',
        visible: () => this.permissions.osd.read
      },
      {
        name: this.i18n('Recovery Priority'),
        icon: Icons.deepCheck,
        click: () => this.configureQosParamsAction(),
        permission: 'read',
        visible: () => this.permissions.configOpt.read
      },
      {
        name: this.i18n('PG scrub'),
        icon: Icons.analyse,
        click: () => this.configurePgScrubAction(),
        permission: 'read',
        visible: () => this.permissions.configOpt.read
      }
    ];
    this.columns = [
      { prop: 'host.name', name: this.i18n('Host') },
      { prop: 'id', name: this.i18n('ID'), cellTransformation: CellTemplate.bold },
      { prop: 'collectedStates', name: this.i18n('Status'), cellTemplate: this.statusColor },
      { prop: 'stats.numpg', name: this.i18n('PGs') },
      { prop: 'stats.stat_bytes', name: this.i18n('Size'), pipe: this.dimlessBinaryPipe },
      { prop: 'stats.usage', name: this.i18n('Usage'), cellTemplate: this.osdUsageTpl },
      {
        prop: 'stats_history.out_bytes',
        name: this.i18n('Read bytes'),
        cellTransformation: CellTemplate.sparkline
      },
      {
        prop: 'stats_history.in_bytes',
        name: this.i18n('Writes bytes'),
        cellTransformation: CellTemplate.sparkline
      },
      {
        prop: 'stats.op_r',
        name: this.i18n('Read ops'),
        cellTransformation: CellTemplate.perSecond
      },
      {
        prop: 'stats.op_w',
        name: this.i18n('Write ops'),
        cellTransformation: CellTemplate.perSecond
      }
    ];
  }

  /**
   * Only returns valid IDs, e.g. if an OSD is falsely still selected after being deleted, it won't
   * get returned.
   */
  getSelectedOsdIds(): number[] {
    const osdIds = this.osds.map((osd) => osd.id);
    return this.selection.selected.map((row) => row.id).filter((id) => osdIds.includes(id));
  }

  getSelectedOsds(): any[] {
    return this.osds.filter(
      (osd) => !_.isUndefined(osd) && this.getSelectedOsdIds().includes(osd.id)
    );
  }

  get hasOsdSelected(): boolean {
    return this.getSelectedOsdIds().length > 0;
  }

  updateSelection(selection: CdTableSelection) {
    this.selection = selection;
  }

  /**
   * Returns true if no rows are selected or if *any* of the selected rows are in the given
   * state. Useful for deactivating the corresponding menu entry.
   */
  isNotSelectedOrInState(state: 'in' | 'up' | 'down' | 'out'): boolean {
    const selectedOsds = this.getSelectedOsds();
    if (selectedOsds.length === 0) {
      return true;
    }
    switch (state) {
      case 'in':
        return selectedOsds.some((osd) => osd.in === 1);
      case 'out':
        return selectedOsds.some((osd) => osd.in !== 1);
      case 'down':
        return selectedOsds.some((osd) => osd.up !== 1);
      case 'up':
        return selectedOsds.some((osd) => osd.up === 1);
    }
  }

  getOsdList() {
    this.osdService.getList().subscribe((data: any[]) => {
      this.osds = data.map((osd) => {
        osd.collectedStates = OsdListComponent.collectStates(osd);
        osd.stats_history.out_bytes = osd.stats_history.op_out_bytes.map((i) => i[1]);
        osd.stats_history.in_bytes = osd.stats_history.op_in_bytes.map((i) => i[1]);
        osd.stats.usage = osd.stats.stat_bytes_used / osd.stats.stat_bytes;
        osd.cdIsBinary = true;
        return osd;
      });
    });
  }

  scrubAction(deep) {
    if (!this.hasOsdSelected) {
      return;
    }

    const initialState = {
      selected: this.getSelectedOsdIds(),
      deep: deep
    };

    this.bsModalRef = this.modalService.show(OsdScrubModalComponent, { initialState });
  }

  configureFlagsAction() {
    this.bsModalRef = this.modalService.show(OsdFlagsModalComponent, {});
  }

  showConfirmationModal(markAction: string, onSubmit: (id: number) => Observable<any>) {
    this.bsModalRef = this.modalService.show(ConfirmationModalComponent, {
      initialState: {
        titleText: this.i18n('Mark OSD {{markAction}}', { markAction: markAction }),
        buttonText: this.i18n('Mark {{markAction}}', { markAction: markAction }),
        bodyTpl: this.markOsdConfirmationTpl,
        bodyContext: {
          markActionDescription: markAction
        },
        onSubmit: () => {
          observableForkJoin(
            this.getSelectedOsdIds().map((osd: any) => onSubmit.call(this.osdService, osd))
          ).subscribe(() => this.bsModalRef.hide());
        }
      }
    });
  }

  reweight() {
    const selectedOsd = this.osds.filter((o) => o.id === this.selection.first().id).pop();
    this.modalService.show(OsdReweightModalComponent, {
      initialState: {
        currentWeight: selectedOsd.weight,
        osdId: selectedOsd.id
      }
    });
  }

  showCriticalConfirmationModal(
    actionDescription: string,
    itemDescription: string,
    templateItemDescription: string,
    action: (id: number) => Observable<any>
  ): void {
    this.osdService.safeToDestroy(JSON.stringify(this.getSelectedOsdIds())).subscribe((result) => {
      const modalRef = this.modalService.show(CriticalConfirmationModalComponent, {
        initialState: {
          actionDescription: actionDescription,
          itemDescription: itemDescription,
          bodyTemplate: this.criticalConfirmationTpl,
          bodyContext: {
            result: result,
            actionDescription: templateItemDescription
          },
          submitAction: () => {
            observableForkJoin(
              this.getSelectedOsdIds().map((osd: any) => action.call(this.osdService, osd))
            ).subscribe(
              () => {
                this.getOsdList();
                modalRef.hide();
              },
              () => modalRef.hide()
            );
          }
        }
      });
    });
  }

  configureQosParamsAction() {
    this.bsModalRef = this.modalService.show(OsdRecvSpeedModalComponent, {});
  }

  configurePgScrubAction() {
    this.bsModalRef = this.modalService.show(OsdPgScrubModalComponent, { class: 'modal-lg' });
  }
}
