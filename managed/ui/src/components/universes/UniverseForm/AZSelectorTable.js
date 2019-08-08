import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { Field } from 'redux-form';
import { YBControlledSelect, YBControlledNumericInput, YBCheckBox } from '../../common/forms/fields';
import { Row, Col } from 'react-bootstrap';
import _ from 'lodash';
import { isNonEmptyArray, isDefinedNotNull, areUniverseConfigsEqual, isEmptyObject, isNonEmptyObject} from '../../../utils/ObjectUtils';
import { FlexContainer, FlexShrink, FlexGrow } from '../../common/flexbox/YBFlexBox';
import { getPrimaryCluster, getReadOnlyCluster, getClusterByType } from '../../../utils/UniverseUtils';
import { getPromiseState } from 'utils/PromiseUtils';

const nodeStateEnums = {
  activeStates: {
    ToBeAdded: "ToBeAdded",
    Provisioned: "Provisioned",
    SoftwareInstalled: "SoftwareInstalled",
    UpgradeSoftware: "UpgradeSoftware",
    UpdateGFlags: "UpdateGFlags",
    Live: "Live",
    Starting: "Starting"
  },
  inactiveStates: {
    Unreachable: "Unreachable",
    ToBeRemoved: "ToBeRemoved",
    Removing: "Removing",
    Removed: "Removed",
    Decommissioned: "Decommissioned",
    BeingDecommissioned:  "BeingDecommissioned",
    Stopping: "Stopping",
    Stopped: "Stopped"
  }
};

export default class AZSelectorTable extends Component {
  constructor(props) {
    super(props);
    if (this.props.type === "Async" && isNonEmptyObject(this.props.universe.currentUniverse.data)) {
      if (isDefinedNotNull(getReadOnlyCluster(this.props.universe.currentUniverse.data.universeDetails.clusters))) {
        this.state = { azItemState: {}, isReadOnlyExists: true};
      } else {
        this.state = { azItemState: {}, isReadOnlyExists: false};
      }
    } else {
      this.state = {azItemState: {}};
    }
  }

  static propTypes = {
    universe: PropTypes.object,
  };

  resetAZSelectionConfig = () => {
    const {universe: {universeConfigTemplate}, clusterType} = this.props;
    const clusters = _.clone(universeConfigTemplate.data.clusters);
    const currentTemplate = _.clone(universeConfigTemplate.data, true);
    if (isNonEmptyArray(clusters)) {
      currentTemplate.clusters.forEach(function(cluster, idx){
        if (cluster.clusterType.toLowerCase() === clusterType) {
          delete currentTemplate.clusters[idx]["placementInfo"];
        }
      });
    }
    currentTemplate.userAZSelected = true;
    currentTemplate.currentClusterType = clusterType.toUpperCase();
    if (isEmptyObject(this.props.universe.currentUniverse.data)) {
      currentTemplate.clusterOperation = 'CREATE';
    } else {
      currentTemplate.clusterOperation = 'EDIT';
    }
    this.props.submitConfigureUniverse(currentTemplate);
  };

  handleAZChange(listKey, event) {
    const {universe: {universeConfigTemplate}} = this.props;
    const currentAZState = this.state.azItemState;
    const universeTemplate = _.clone(universeConfigTemplate.data);
    if (!currentAZState.some((azItem) => azItem.value === event.target.value)) {
      currentAZState[listKey].value = event.target.value;
      this.updatePlacementInfo(currentAZState, universeTemplate);
    }
  };

  handleAZNodeCountChange(listKey, value) {
    const {universe: {universeConfigTemplate}} = this.props;
    const universeTemplate = _.clone(universeConfigTemplate.data);
    const currentAZState = this.state.azItemState;
    currentAZState[listKey].count = value;
    this.updatePlacementInfo(currentAZState, universeTemplate);
  };

  handleAffinitizedZoneChange(idx) {
    const {universe: {universeConfigTemplate}} = this.props;
    const currentAZState = this.state.azItemState;
    const universeTemplate = _.clone(universeConfigTemplate.data);
    currentAZState[idx].isAffinitized = !currentAZState[idx].isAffinitized;
    this.updatePlacementInfo(currentAZState, universeTemplate);
  };

  // Method takes in the cluster object that is being modified
  // and returns a list of objects each containing the azUUID, azName and count in the record.
  getZonesWithCounts = (cluster) => {
    const {cloud: {regions}} = this.props;
    return regions.data.filter((region) => {
      return cluster.userIntent.regionList.includes(region.uuid);
    }).reduce((az, region) => {
      return az.concat(region.zones);
    }, []);
  }

  updatePlacementInfo = (currentAZState, universeConfigTemplate) => {
    const {universe: {currentUniverse}, cloud, numNodesChangedViaAzList, currentProvider, maxNumNodes,
           minNumNodes, clusterType} = this.props;
    this.setState({azItemState: currentAZState});
    let totalNodesInConfig = 0;
    currentAZState.forEach(function(item){
      totalNodesInConfig += item.count;
    });
    numNodesChangedViaAzList(totalNodesInConfig);

    const cluster = clusterType === "primary"
                    ? getPrimaryCluster(universeConfigTemplate.clusters)
                    : getReadOnlyCluster(universeConfigTemplate.clusters);

    if ((currentProvider.code !== "onprem" || totalNodesInConfig <= maxNumNodes) &&
        totalNodesInConfig >= minNumNodes && isNonEmptyObject(cluster)) {
      const newPlacementInfo = _.clone(cluster.placementInfo, true);
      const newRegionList = [];
      cloud.regions.data.forEach(function (regionItem) {
        const newAzList = [];
        let zoneFoundInRegion = false;
        regionItem.zones.forEach(function (zoneItem) {
          currentAZState.forEach(function (azItem) {
            if (zoneItem.uuid === azItem.value) {
              zoneFoundInRegion = true;
              newAzList.push({
                uuid: zoneItem.uuid,
                replicationFactor: 1,
                subnet: zoneItem.subnet,
                name: zoneItem.name,
                numNodesInAZ: azItem.count,
                isAffinitized: azItem.isAffinitized
              });
            }
          });
        });
        if (zoneFoundInRegion) {
          newRegionList.push({
            uuid: regionItem.uuid,
            code: regionItem.code,
            name: regionItem.name,
            azList: newAzList
          });
        }
      });
      newPlacementInfo.cloudList[0].regionList = newRegionList;
      const newTaskParams = _.clone(universeConfigTemplate, true);
      if (isNonEmptyArray(newTaskParams.clusters)) {
        newTaskParams.clusters.forEach((cluster) => {
          if (clusterType === "primary" && cluster.clusterType === 'PRIMARY') {
            cluster.placementInfo = newPlacementInfo;
            cluster.userIntent.numNodes = totalNodesInConfig;
          } else if (clusterType === "async" && cluster.clusterType === 'ASYNC') {
            cluster.placementInfo = newPlacementInfo;
            cluster.userIntent.numNodes = totalNodesInConfig;
          }
        });
      }
      if (isEmptyObject(currentUniverse.data)) {
        newTaskParams.currentClusterType = clusterType.toUpperCase();
        newTaskParams.clusterOperation = "CREATE";
        this.props.submitConfigureUniverse(newTaskParams);
      } else if (!areUniverseConfigsEqual(newTaskParams, currentUniverse.data.universeDetails)) {
        newTaskParams.universeUUID = currentUniverse.data.universeUUID;
        newTaskParams.currentClusterType = clusterType.toUpperCase();
        newTaskParams.clusterOperation = "EDIT";
        newTaskParams.expectedUniverseVersion = currentUniverse.data.version;
        this.props.submitConfigureUniverse(newTaskParams);
      } else {
        const placementStatusObject = {
          error: {
            type: "noFieldsChanged",
            numNodes: totalNodesInConfig,
            maxNumNodes: maxNumNodes
          }
        };
        this.props.setPlacementStatus(placementStatusObject);
      }
    } else if (totalNodesInConfig > maxNumNodes && currentProvider.code === "onprem") {
      const placementStatusObject = {
        error: {
          type: "notEnoughNodesConfigured",
          numNodes: totalNodesInConfig,
          maxNumNodes: maxNumNodes
        }
      };
      this.props.setPlacementStatus(placementStatusObject);
    } else {
      const placementStatusObject = {
        error: {
          type: "notEnoughNodes",
          numNodes: totalNodesInConfig,
          maxNumNodes: maxNumNodes
        }
      };
      this.props.setPlacementStatus(placementStatusObject);
    }
  };

  getGroupWithCounts = universeConfigTemplate => {
    const {cloud: {regions}, clusterType} = this.props;
    const uniConfigArray = [];
    let cluster = null;
    if (isNonEmptyObject(universeConfigTemplate)) {
      if (clusterType === "primary") {
        cluster = getPrimaryCluster(universeConfigTemplate.clusters);
      } else {
        cluster = getReadOnlyCluster(universeConfigTemplate.clusters);
      }
    }

    let currentClusterNodes = [];
    if (isNonEmptyObject(universeConfigTemplate) && isNonEmptyObject(universeConfigTemplate.nodeDetailsSet) && isNonEmptyObject(cluster)) {
      currentClusterNodes =
      universeConfigTemplate.nodeDetailsSet.filter(function (nodeItem) {
        return nodeItem.placementUuid === cluster.uuid && (
          nodeItem.state === nodeStateEnums.activeStates.ToBeAdded ||
          nodeItem.state === nodeStateEnums.activeStates.Live ||
          nodeItem.state === nodeStateEnums.inactiveStates.ToBeRemoved // In case user wants to revert
          );
      });
    }

    if (isNonEmptyObject(universeConfigTemplate) && isNonEmptyArray(currentClusterNodes)) {
      currentClusterNodes.forEach(function (nodeItem) {
        if (nodeItem.state in nodeStateEnums.activeStates || nodeItem.state === nodeStateEnums.inactiveStates.ToBeRemoved) {
          let nodeFound = false;
          for (let idx = 0; idx < uniConfigArray.length; idx++) {
            if (uniConfigArray[idx].value === nodeItem.azUuid) {
              nodeFound = true;
              uniConfigArray[idx].count++;
              break;
            }
          }
          if (!nodeFound) {
            if (nodeItem.state === nodeStateEnums.inactiveStates.ToBeRemoved) {
              uniConfigArray.push({value: nodeItem.azUuid, count: 0});
            } else {
              uniConfigArray.push({value: nodeItem.azUuid, count: 1});
            }
          }
        }
      });
    }

    let groupsArray = [];
    const uniqueRegions = [];
    if (isNonEmptyObject(cluster) &&
        isNonEmptyObject(cluster.placementInfo) &&
        isNonEmptyArray(cluster.placementInfo.cloudList) &&
        isNonEmptyArray(cluster.placementInfo.cloudList[0].regionList)) {
      cluster.placementInfo.cloudList[0].regionList.forEach(function(regionItem) {
        regionItem.azList.forEach(function(azItem) {          
          uniConfigArray.forEach(function(configArrayItem) {
            if (configArrayItem.value === azItem.uuid) {
              groupsArray.push({value: azItem.uuid, count: configArrayItem.count,
                isAffinitized: azItem.isAffinitized === undefined ? true : azItem.isAffinitized});
              if (uniqueRegions.indexOf(regionItem.uuid) === -1) {
                uniqueRegions.push(regionItem.uuid);
              }
            }
          });
        });
      });
    }

    const clusters = universeConfigTemplate.clusters;
    if (isNonEmptyArray(clusters)) {
      let azListForSelectedRegions = [];
      const sortedGroupArray = [];
      const currentCluster = getClusterByType(clusters, clusterType);
      if (isNonEmptyObject(currentCluster) && isNonEmptyObject(currentCluster.userIntent) &&
        isNonEmptyArray(currentCluster.userIntent.regionList) && isNonEmptyArray(regions.data)) {
        azListForSelectedRegions = this.getZonesWithCounts(currentCluster);
      }
      const sortedAZListForSelectedRegions = azListForSelectedRegions.sort(function(a, b){
        return a.code > b.code ? 1 : -1 ;
      });
      sortedAZListForSelectedRegions.forEach(function(azListRegionItem){
        const currentazItem = groupsArray.find((a)=>(a.value  === azListRegionItem.uuid));
        if (isNonEmptyObject(currentazItem)) {
          sortedGroupArray.push(currentazItem);
        }
      });
      if (isNonEmptyArray(sortedGroupArray)) {
        groupsArray = sortedGroupArray;
      }
    }

    const nonZeroUniqueAzs = [
      ...new Set(groupsArray.reduce((prev, curr) => {
        if (curr.count > 0) {
          prev.push(curr.value);
        }
        return prev;
      }, [])
      )
    ];
    return ({
      groups: groupsArray,
      uniqueRegions: uniqueRegions.length,
      uniqueAzs: nonZeroUniqueAzs.length
    });
  };

  componentWillMount() {
    const {universe: {currentUniverse, universeConfigTemplate}, type, clusterType} = this.props;
    const currentCluster = getClusterByType(universeConfigTemplate.data.clusters, clusterType);
    // Set AZ Groups when switching back to a cluster tab
    if (isNonEmptyObject(currentCluster)) {
      const azGroups = this.getGroupWithCounts(universeConfigTemplate.data).groups;
      this.setState({azItemState: azGroups});
    }
    if ((type === "Edit" || (type === "Async" && this.state.isReadOnlyExists)) && isNonEmptyObject(currentUniverse)) {
      const azGroups = this.getGroupWithCounts(currentUniverse.data.universeDetails).groups;
      this.setState({azItemState: azGroups});
    }
  }

  componentWillReceiveProps(nextProps) {
    const {universe: {universeConfigTemplate, currentUniverse}, clusterType, type } = nextProps;
    if ((getPromiseState(universeConfigTemplate).isSuccess())) {
      const placementInfo = this.getGroupWithCounts(universeConfigTemplate.data);
      const azGroups = placementInfo.groups;
      if (!areUniverseConfigsEqual(this.props.universe.universeConfigTemplate.data, universeConfigTemplate.data)) {
        this.setState({azItemState: azGroups});
      }
      const currentCluster =  getPromiseState(currentUniverse).isSuccess() ? getClusterByType(currentUniverse.data.universeDetails.clusters, clusterType) : {};
      const configTemplateCurrentCluster = isNonEmptyObject(universeConfigTemplate.data) ?
        getClusterByType(universeConfigTemplate.data.clusters, clusterType) :
        null;
      if (isNonEmptyObject(configTemplateCurrentCluster) && isNonEmptyObject(configTemplateCurrentCluster.placementInfo) &&
          !_.isEqual(universeConfigTemplate, this.props.universe.universeConfigTemplate)) {
        const uniqueAZs = [ ...new Set(azGroups.map(item => item.value)) ];
        const totalNodes = placementInfo.groups.reduce((acc, obj) => acc + obj.count, 0);
        if (isNonEmptyObject(uniqueAZs) && (type === "Create" || (type === "Async" && !isDefinedNotNull(currentCluster)) || currentCluster.userIntent.numNodes !== totalNodes)) {
          const placementStatusObject = {
            numUniqueRegions: placementInfo.uniqueRegions,
            numUniqueAzs: placementInfo.uniqueAzs,
            replicationFactor: configTemplateCurrentCluster.userIntent.replicationFactor
          };
          this.props.setPlacementStatus(placementStatusObject);
        }
      }
    }
  }

  render() {
    const { universe: { universeConfigTemplate }, cloud: { regions }, clusterType } = this.props;
    const self = this;
    const isReadOnlyTab = clusterType === "async";
    let azListForSelectedRegions = [];

    let currentCluster = null;

    if (isNonEmptyObject(universeConfigTemplate.data) && isNonEmptyArray(universeConfigTemplate.data.clusters)) {
      currentCluster = getClusterByType(universeConfigTemplate.data.clusters, clusterType);
    }

    if (isNonEmptyObject(currentCluster) && isNonEmptyObject(currentCluster.userIntent) &&
        isNonEmptyArray(currentCluster.userIntent.regionList) && isNonEmptyArray(regions.data)) {
      azListForSelectedRegions = this.getZonesWithCounts(currentCluster);
    }
    let azListOptions = <option/>;
    if (isNonEmptyArray(azListForSelectedRegions)) {
      azListOptions = azListForSelectedRegions.map((azItem, azIdx) => (
        <option key={azIdx} value={azItem.uuid}>{azItem.code}</option>
      ));
    }
    const azGroups = self.state.azItemState;
    let azList = [];
    if (isNonEmptyArray(azGroups) && isNonEmptyArray(azListForSelectedRegions)) {
      azList = azGroups.map((azGroupItem, idx) => (
        <FlexContainer key={idx}>
          <FlexGrow power={1}>
            <Row>
              <Col xs={8}>
                <Field name={`select${idx}`} component={YBControlledSelect}
                    options={azListOptions} selectVal={azGroupItem.value}
                    onInputChanged={self.handleAZChange.bind(self, idx)}/>
              </Col>
              <Col xs={4}>
                <Field name={`nodes${idx}`} component={YBControlledNumericInput}
                val={azGroupItem.count}
                className={getPromiseState(universeConfigTemplate).isLoading() ? "readonly" : ""}
                onInputChanged={self.handleAZNodeCountChange.bind(self, idx)}/>
              </Col>
            </Row>
          </FlexGrow>
          {!isReadOnlyTab && <FlexShrink power={0} key={idx} className="form-right-control">
            <Field name={`affinitized${idx}`} component={YBCheckBox} checkState={azGroupItem.isAffinitized}
                  onClick={self.handleAffinitizedZoneChange.bind(self, idx)}/>
          </FlexShrink>}
        </FlexContainer>
      ));
      return (
        <div className={"az-table-container form-field-grid"}>
          <div className="az-selector-label">
            <span className="az-selector-reset" onClick={this.resetAZSelectionConfig}>Reset Config</span>
            <h4>Availability Zones</h4>
          </div>
          <FlexContainer>
            <FlexGrow power={1}>
              <Row>
                <Col xs={8}>
                  <label>Name</label>
                </Col>
                <Col xs={4}>
                  <label>{this.props.isKubernetesUniverse ? "Pods" : "Nodes"}</label>
                </Col>
              </Row>
            </FlexGrow>
            {!isReadOnlyTab && <FlexShrink power={0} className="form-right-control">
              <label>Preferred</label>
            </FlexShrink>}
          </FlexContainer>
          {azList}
        </div>
      );
    }
    return <span/>;
  }
}
