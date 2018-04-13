import {CKLocation, CKRef, CKTimestamp} from "../app/models/cloudkit.types";
import {ChargeEventSource, GeoJSON, ILadelog} from "../app/models/chargeevent.model";
import {format} from "util";
const goingElectricStrings = require('./goingelectric');

const Entities = require('html-entities').AllHtmlEntities;
const entities = new Entities();

export enum CKCheckInReason {
  // noinspection JSUnusedGlobalSymbols
  ok = 10,
  recovery = 11,

  // failed
  equipementProblem = 100, equipementProblemNew,
  notCompatible, notCompatibleNew,
  noChargingEquipement, noChargingEquipementNew,

  // other
  notFound = 200,
  dupplicate,
  positive,
  negative,
}

export interface CKRecordUpsert {
  recordName?: string;
  recordChangeTag?: string;
  deleted?: boolean
  created?: CKTimestamp;
  modified?: CKTimestamp;
}

interface CKCheckIn extends CKRecordUpsert {
  fields: {
    chargepoint: CKRef;
    comment?: CKField<string>;
    location: CKField<CKLocation>;
    reason: CKField<CKCheckInReason>;
    plug?: CKField<string>;
    timestamp: CKField<Date>;
    source?: CKField<ChargeEventSource>;
  };
}

interface CKChargePoint extends CKRecordUpsert {
  fields: {
    chargePointHash: CKField<number>;
    location: CKField<CKLocation>;
    name: CKField<string>;
    reason: CKField<CKCheckInReason>;
    reasonDescription?: CKField<string>;
    timestamp: CKField<Date>;
    url: CKField<string>;
  };
}

class CKField<T> {
  value: T | number;
  constructor(value: T) {
    // noinspection SuspiciousInstanceOfGuard
    if (value instanceof Date) {
      this.value = value.getTime();
    } else {
      this.value = value;
    }
  }
}

export class ChargepointRef implements CKRef {
  value: {
    recordName: string;
    action?: string;
  };
  type: string;

  constructor(recordName: string) {
    this.value = {
      recordName: recordName,
      action: 'DELETE_SELF',
    };
    this.type = 'REFERENCE';
  }
}

class GELocation implements CKLocation {
  latitude: number;
  longitude: number;

  constructor(location: GeoJSON) {
    this.latitude = location.coordinates[0];
    this.longitude = location.coordinates[1];
  }
}

export class CKCheckFromLadelog implements CKCheckIn {
  fields: {
    chargepoint: CKRef;
    comment?: CKField<string>;
    location: CKField<CKLocation>;
    reason: CKField<CKCheckInReason>;
    plug?: CKField<string>;
    timestamp: CKField<Date>;
    source?: CKField<ChargeEventSource>;
  };
  recordType?: string;
  recordChangeTag?: string;
  deleted?: boolean;
  created?: CKTimestamp;
  modified?: CKTimestamp;

  constructor(ladelog: ILadelog) {
    this.recordType = 'CheckIns';
    this.fields = <any>{
      source: new CKField(ChargeEventSource.goingElectric),
      chargepoint: new ChargepointRef(ladelog.chargepoint),
      location: new CKField(new GELocation(ladelog.location)),
    };

    this.fields.timestamp = new CKField(ladelog.modified);
    this.fields.comment = new CKField(entities.decode(ladelog.comment));
    this.fields.reason = new CKField(ladelog.isFault ? CKCheckInReason.equipementProblem : CKCheckInReason.ok);
  }

  toString() {
    return `CheckIn [reason: ${this.fields.reason.value}, timestamp: ${new Date(this.fields.timestamp.value as number)}]`;
  }
}


export class GEChargepoint implements CKChargePoint {

  /**
   * Reason Code Description
   *
   * @param {CKCheckInReason} reason code
   * @returns {string} (non localized) description
   */
  private static getCheckInReasonDescription(reason: CKCheckInReason): string {
    const reasonCode = CKCheckInReason[reason];

    // reasonCode is e.g. "ok" or "recovery"
    if (reasonCode) {
      const description = goingElectricStrings.reasonDescription[reasonCode];
      if (description) {
        return description;
      }
    }

    return format(goingElectricStrings.reasonDescription.default, reason);
  }

  fields: {
    chargePointHash: CKField<number>;
    location: CKField<CKLocation>;
    name: CKField<string>;
    reason: CKField<CKCheckInReason>;
    reasonDescription?: CKField<string>;
    timestamp: CKField<Date>;
    url: CKField<string>;
  };
  recordType: string;
  recordName: string;
  recordChangeTag?: string;

  constructor(chargelocation: any, checkIn: CKCheckIn, lastCheckIn?: CKCheckIn) {
    // TODO: this is not fully functional now!
    this.recordType = 'ChargePoints';
    this.recordName = (new ChargepointRef(chargelocation)).value.recordName;

    this.fields = {
      chargePointHash: new CKField(chargelocation.ge_id),
      location: new CKField(new GELocation(chargelocation.coordinates)),
      timestamp: checkIn.fields.timestamp,
      name: new CKField(entities.decode(chargelocation.name)),
      url: new CKField('http:' + chargelocation.url),
      reason: new CKField(checkIn.fields.reason.value),
      reasonDescription: new CKField(GEChargepoint.getCheckInReasonDescription(checkIn.fields.reason.value)),
    };

    // Recovery/initial fault handling
    // We want to increment the reasonCode if
    // a) this is the first checkin and this checkin is negative OR
    // b) we do have an older checkin and the new state differs from the old one (we have a transition).
    // c) additionally we don't want to increment the reasonCode if the checkIn is older than 3 days
    if (!lastCheckIn && this.fields.reason.value === CKCheckInReason.equipementProblem ||
        lastCheckIn && lastCheckIn.fields.reason.value !== checkIn.fields.reason.value
    ) {
      const now = (new Date()).getTime();
      if (this.fields.timestamp.value >= (now - 3 * 24 * 3600 * 1000)) { // not older than 3 days
        this.fields.reason.value++;
      }
    }

  }

  toString() {
    return `${this.recordName} [reason: ${this.fields.reason.value}]`;
  }
}
