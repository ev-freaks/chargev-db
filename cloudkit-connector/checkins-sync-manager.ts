import {
  allSourcesOtherThanChargEVSource,
  ChargeEventSource,
  CheckIn,
  CKCheckIn,
  ICheckIn,
  Point
} from "../app/models/chargeevent.model";
import {CKUser, getCKUserFromCKRecord} from "../app/models/ck-user.model";
import {CloudKitService} from "../cloudkit/cloudkit-service";
import * as CloudKit from "../cloudkit/vendor/cloudkit";

export class CheckInsSyncManager {

  constructor(private service: CloudKitService) {

  }

  private getCheckInFromCKRecord(record: any) {

    function getValue(fieldName: string) {
      if (fieldName in record.fields) {
        return record.fields[fieldName].value;
      }
      return null;
    }

    return <CheckIn>{
      recordName: record.recordName,
      recordChangeTag: record.recordChangeTag,
      created: record.created,
      modified: record.modified,
      deleted: record.deleted,
      source: getValue('source') || ChargeEventSource.cloudKit,
      timestamp: new Date(getValue('timestamp')),
      reason: getValue('reason'),
      comment: getValue('comment'),
      plug: getValue('plug'),
      chargepoint: getValue('chargepoint').recordName,
      location: new Point(getValue('location')),
    };
  }

  private async syncDeletedCheckInsFromCloudKit(newestTimestamp: number): Promise<void> {

    const getChangedChargepointsRefs = async (newestTimestamp: number): Promise<any[]> => {
      const query = {
        recordType: 'Chargepoints',
        filterBy: [
          {
            fieldName: "___modTime",
            comparator: CloudKit.QueryFilterComparator.GREATER_THAN,
            fieldValue: {value: newestTimestamp},
          }
        ],
      };

      const options = {
        desiredKeys: [ ] // we do only need the recordName, no other info
      };

      const chargepointRefs: any[] = [];

      await this.service.find(query, options, async (records: any[]) => {
        // console.log(JSON.stringify(records, null, 4));
        for (let record of records) {
          chargepointRefs.push(record.recordName);
        }
      });

      return chargepointRefs;
    };

    const getCheckInRecordNames = async (chargepoints: string[]): Promise<string[]> => {
      const query = {
        recordType: 'CheckIns',
        filterBy: [
          {
            comparator: CloudKit.QueryFilterComparator.IN,
            fieldName: "chargepoint",
            fieldValue: {
              value: chargepoints.map($0 => <any>{recordName: $0}),
            },
          }
        ],
      };

      const options = {
        desiredKeys: [ ] // we do only need the recordName, no other info
      };

      const recordNames: string[] = [];

      await this.service.find(query, options, async (records: any[]) => {
        // console.log(JSON.stringify(records, null, 4));
        for (let record of records) {
          recordNames.push(record.recordName);
        }
      });

      return recordNames;
    };

    const chargepointRefs = await getChangedChargepointsRefs(newestTimestamp);

    if (chargepointRefs.length === 0) {
      // nothing to do
      return;
    }

    const checkInsFromCloudKitRecordNames = await getCheckInRecordNames(chargepointRefs);
    const checkInsInLocalDatabase = await CKCheckIn.find({chargepoint: {$in: chargepointRefs}, deleted: false}, {recordName: 1});
    const checkInRecordNamesInLocalDatabase = new Set(checkInsInLocalDatabase.map(checkIn => checkIn.recordName));

    // we remove all items which do exists in cloudkit
    checkInsFromCloudKitRecordNames.forEach($0 => checkInRecordNamesInLocalDatabase.delete($0));

    // and then set the remaining entries as deleted
    let checkRecordNamesToDelete = Array.from(checkInRecordNamesInLocalDatabase);

    if (checkRecordNamesToDelete.length === 0) {
      return;
    }

    await CKCheckIn.update({ recordName: { $in: checkRecordNamesToDelete } }, {deleted: true, updatedAt: Date.now()}, {multi: true});
    console.log(`Set ${checkRecordNamesToDelete.length} record(s) as deleted: [${checkRecordNamesToDelete.join(',')}]`);
  };

  public async syncCheckInsFromCloudKit(purge = false): Promise<ICheckIn[]> {

    if (purge) {
      await CKCheckIn.remove({});
    }
    const newestCheckIn = await CKCheckIn.findOne({source: ChargeEventSource.cloudKit }, {}, {sort: {'modified.timestamp': -1}});
    const newestTimestamp = newestCheckIn ? newestCheckIn.modified.timestamp : 0;

    const query = {
      recordType: 'CheckIns',
      filterBy: <any>[],
      sortBy: [
        { systemFieldName: "modifiedTimestamp", ascending: true },
      ],
    };

    const options = {};

    query.filterBy.push({
      fieldName: "source",
      comparator: CloudKit.QueryFilterComparator.NOT_IN,
      fieldValue: { value: allSourcesOtherThanChargEVSource }
    });

    if (newestTimestamp) {
      query.filterBy.push({
        // @see https://forums.developer.apple.com/thread/28126
        systemFieldName: "modifiedTimestamp",
        comparator: CloudKit.QueryFilterComparator.GREATER_THAN,
        fieldValue: { value: newestTimestamp },
      });
    }

    const updatedCheckIns: any[] = [];

    await this.service.find(query, options, async (records: any[]) => {
      // console.log(JSON.stringify(records, null, 4));
      let count = 0;
      for (let record of records) {
        const checkIn = this.getCheckInFromCKRecord(record);
        updatedCheckIns.push(checkIn);
        await CKCheckIn.findOneAndUpdate({recordName: record.recordName}, checkIn, {upsert: true});
        count++;
      }
      console.log('Sync CloudKit CheckIns: %d record(s) processed.', count);
    });

    if (!purge && newestTimestamp) {
      await this.syncDeletedCheckInsFromCloudKit(newestTimestamp);
    }

    return updatedCheckIns;
  };

  public async syncUsersFromCloudKit(checkIns: ICheckIn[], purge = false): Promise<void> {

    if (purge) {
      await CKUser.remove({});
    }

    const allUserRecordNames = new Set(checkIns.map(checkIn => checkIn.modified.userRecordName));

    await this.service.get(Array.from(allUserRecordNames).map($0 => { return { recordType: 'User', recordName: $0}}),
        {}, async (records: any[]) => {
      // console.log(JSON.stringify(records, null, 4));
      let count = 0;
      for (let record of records) {
        const user = getCKUserFromCKRecord(record);
        await CKUser.findOneAndUpdate({recordName: record.recordName}, user, {upsert: true});
        count++;
      }
      console.log('Sync CloudKit User Records: %d record(s) processed.', count);
    });
  };

}