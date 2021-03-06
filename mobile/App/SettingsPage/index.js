
import React from 'react';

import {
  View,
  Image,
  TouchableOpacity,
} from 'react-native';

import { Container, Header, Content, Footer, FooterTab, Text, Button, Spinner } from 'native-base';

import HVComponent, { HVConfirmDialog } from '../HVComponent';

import { StackActions, NavigationActions } from 'react-navigation';
import RNGooglePlaces from 'react-native-google-places';
import { Dialog } from 'react-native-simple-dialogs';
import Icon from 'react-native-vector-icons/FontAwesome';
import storage from 'react-native-storage-wrapper';
import SmLogin from '../SmLogin';
import { google_api_key } from '../config';
import {
  DINFO, _getJWT, _saveJWT, _loginPing, _logout, _saveUser, openURL, openGitHub,
  _apiCall, _specificAddress, permissionNotify, permissionLocation, say,
} from '../common';

import {
  SettingsDividerShort,
  SettingsDividerLong,
  SettingsCategoryHeader,
  SettingsButton,
  SettingsSwitch,
  SettingsPicker,
  SettingsTextLabel,
} from 'react-native-settings-components';

const party_data = [
  { key: 'I', label: 'No Party Preference', value: 'No Party Preference' },
  { key: 'D', label: 'Democrat', value: 'Democrat' },
  { key: 'R', label: 'Republican', value: 'Republican' },
  { key: 'G', label: 'Green', value: 'Green' },
  { key: 'L', label: 'Libertarian', value: 'Libertarian' },
  { key: 'O', label: 'Other', value: 'Other' },
];

function _partyName(party) {
  let p = party_data.filter(d => party === d.key);
  if (p[0] && p[0].key) return p[0].value;
  return '';
}

function _partyKey(name) {
  let p = party_data.filter(d => name === d.value);
  if (p[0] && p[0].value) return p[0].key;
  return '';
}

export default class App extends HVComponent {

  constructor(props) {
    super(props);

    this.state = {
      SmLoginScreen: false,
      profileUpdate: false,
      surveyComplete: false,
      surveyPartial: false,
      user: null,
      party: null,
      myPosition: { address: null, longitude: null, latitude: null },
      havePermLocation: false,
      havePermNotification: false,
      appVersion: "unknown",
    };

  }

  _logout() {
    _logout();
    this.goHome();
  }

  goHome() {
    const resetAction = StackActions.reset({
      index: 0,
      actions: [
        NavigationActions.navigate({ routeName: 'HomeScreen'})
      ]
    });
    this.props.navigation.dispatch(resetAction);
  }

  _loadProfile = async () => {
    var user = await _getJWT(true);
    if (user) {
      this.setState({
        user: user,
        party: user.profile.party,
        myPosition: {
          address: user.profile.home_address,
          longitude: user.profile.home_lng,
          latitude: user.profile.home_lat
        },
      });
    } else {
      _loginPing(this, false);
    }
  }

  _updateProfile = async () => {
    const { party, partyOld, myPosition, myPositionOld } = this.state;
    let { user } = this.state;
    if (party !== partyOld || (myPositionOld && myPosition.address !== myPositionOld.address)) {
      user.profile.party = party;
      user.profile.home_address = myPosition.address;
      user.profile.home_lng = myPosition.longitude;
      user.profile.home_lat = myPosition.latitude;
      if (user.lastsearchpos && user.lastsearchpos.icon == 'home') {
        user.lastsearchpos = myPosition;
        user.lastsearchpos.icon = 'home';
      }
      _saveUser(user, true);
      this.setState({user: user});
    }
    this.setState({profileUpdate: false});
  }

  componentDidMount() {
    DINFO().then(i => this.setState({appVersion: i.Version})).catch(e => console.warn(e));
    this.checkPermissionLocation();
    this.checkPermissionNotification();
    this._loadProfile();
  }

  componentDidUpdate(prevProps, prevState) {
    const { profileUpdate, SmLoginScreen, party, myPosition, user } = this.state;

    if (profileUpdate)
      this._updateProfile();

    if (prevState.SmLoginScreen && !SmLoginScreen)
      setTimeout(() => {this._loadProfile();}, 500);
  }

  checkPermissionLocation = async () => {
    let access = false;
    try {
      access = await permissionLocation();
    } catch(error) {
      // nothing we can do about it
    }
    this.setState({havePermLocation: access});
  }

  checkPermissionNotification = async () => {
    let access = false;
    try {
      access = await permissionNotify();
    } catch(error) {
      // nothing we can do about it
    }
    this.setState({havePermNotification: access});
  }

  render() {
    const {
      user, havePermLocation, havePermNotification, SmLoginScreen,
      surveyComplete, surveyPartial, party, myPosition, appVersion,
    } = this.state;

    // wait for user object to become available
    if (!user) return (
        <View style={{flex: 1, backgroundColor: 'white', alignItems: 'center', justifyContent: 'center'}}>
          <Text style={{fontSize: 20}}>Loading profile information...</Text>
          <Spinner />
        </View>
      );

    return (
      <Container>
        <Content padder>
      <SettingsCategoryHeader title={"Personal Settings"} />

      <SettingsDividerLong />

        <View style={{flexDirection: 'row', margin: 20, marginBottom: 10}}>
          <View style={{flex: 1}}>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <Icon style={{marginRight: 10}} name="user-plus" size={18} color="black" />
              <Text style={{fontSize: 20}}>Login Status:</Text>
            </View>
          </View>
          {user.loggedin &&
          <View style={{flexDirection: 'row', alignItems: 'center', marginRight: 20}}>
            <Text style={{marginRight: 7, fontWeight: 'bold'}}>Active</Text>
            <Icon name="check-circle" size={30} color="green" />
          </View>
          || user.lastsmlogin &&
          <View style={{flexDirection: 'row', alignItems: 'center', marginRight: 20}}>
            <Text style={{marginRight: 7, fontWeight: 'bold'}}>Session Expired</Text>
            <Icon name="exclamation-triangle" size={30} color="orange" />
          </View>
          ||
          <View style={{flexDirection: 'row', alignItems: 'center', marginRight: 20}}>
            <Text style={{marginRight: 7, fontWeight: 'bold'}}>Not Logged In</Text>
            <Icon name="times-circle" size={30} color="red" />
          </View>
          }
        </View>

        {!user.loggedin &&
        <View style={{flex: 1, alignItems: 'center', marginBottom: 10}}>
          <TouchableOpacity
            style={{flexDirection: 'row', padding: 10, alignItems: 'center', backgroundColor: '#d7d7d7'}}
            onPress={() => {this.setState({SmLoginScreen: true})}}>
            <Text>Tap to Log In</Text>
          </TouchableOpacity>
        </View>
        }

        {user.loggedin &&
        <View style={{flexDirection: 'row', margin: 20, marginTop: 0, marginBottom: 10, alignItems: 'center'}}>
          <View style={{marginRight: 20}}>
            <Image source={{ uri: user.avatar }} style={{height: 50, width: 50, borderRadius: 20}} />
          </View>
          <View style={{flex: 1}}>
            <Text>Welcome, {user.name}!</Text>
          </View>
        </View>
        || user.lastsmlogin &&
        <View style={{flexDirection: 'row', margin: 20, marginTop: 0, marginBottom: 10}}>
          <View style={{marginRight: 20}}>
            <Image source={{ uri: user.avatar }} style={{height: 50, width: 50, borderRadius: 20}} />
          </View>
          <View style={{flex: 1}}>
            <Text>
              Welcome back! You are signed out; for the best user experience, please login again.
            </Text>
          </View>
        </View>
        ||
        <SettingsTextLabel title={"For the best user experience, login with a social media account."} />
        }

        <SettingsDividerShort />

        <SettingsPicker
          title={"Home Address"}
          options={[{label: '', value: ''}]}
          value={myPosition.address}
          valuePlaceholder={"Not Set"}
          onValueChange={() => {}}
          onPressOverride={true}
          onPress={() => {
            RNGooglePlaces.openAutocompleteModal()
            .then((place) => {
              if (!_specificAddress(place.address)) {
                this.alert(
                  say("ambiguous_address"),
                  say("no_guarantee_district"),
                  {
                    title: say("continue_anyway"),
                    onPress: () => {
                      this.setState({
                        profileUpdate: true,
                        myPositionOld: myPosition,
                        myPosition: place,
                        confirmDialog: false,
                      });
                    },
                  },
                  {
                    title: say("cancel"),
                    onPress: () => this.setState({confirmDialog: false}),
                  }
                );
              } else {
                this.setState({
                  profileUpdate: true,
                  myPositionOld: myPosition,
                  myPosition: place,
                });
              }
            })
            .catch(error => console.log(error.message));
          }}
        />

        <SettingsTextLabel title={"We use your home address to give you information most relevant to you. You may simply enter a city or a state, but we cannot guarantee accurate district results without a whole address."} />

        <SettingsDividerShort />

        <SettingsPicker
          title={"Party Affiliation"}
          dialogDescription={"Select the political party you belong to."}
          options={party_data}
          onValueChange={value => this.setState({
            profileUpdate: true,
            partyOld: party,
            party: _partyKey(value),
          })}
          value={_partyName(party)}
          valuePlaceholder={"Not Set"}
          styleModalButtonsText={{ color: colors.monza }}
        />

        <SettingsTextLabel title={"We use your party affiliation to better categorize information for you. If not set, we assume you have no party preference."} />

        <SettingsDividerLong />

        <SettingsCategoryHeader title={"App Permissions"} />

        <SettingsDividerLong />

        <View style={{flexDirection: 'row', margin: 20, marginBottom: 10}}>
          <View style={{flex: 1}}>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <Icon style={{marginRight: 10}} name="map-marker" size={22} color="black" />
              <Text style={{fontSize: 20}}>Location Permissions:</Text>
            </View>
          </View>
          {havePermLocation &&
          <View style={{flexDirection: 'row', alignItems: 'center', marginRight: 20}}>
            <Text style={{marginRight: 7, fontWeight: 'bold'}}>On</Text>
            <Icon name="check-circle" size={30} color="green" />
          </View>
          ||
          <TouchableOpacity style={{flexDirection: 'row', alignItems: 'center', marginRight: 20}}>
            <Text style={{marginRight: 7, fontWeight: 'bold'}}>Off</Text>
            <Icon name="times-circle" size={30} color="red" />
          </TouchableOpacity>
          }
        </View>
        <SettingsTextLabel title={"We use your device location when you select the \"current location\" option when searching representatives, or when using the canvassing tool."} />

        <SettingsDividerShort />

        <View style={{flexDirection: 'row', margin: 20}}>
          <View style={{flex: 1}}>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <Icon style={{marginRight: 10}} name="exclamation-circle" size={22} color="black" />
              <Text style={{fontSize: 20}}>Push Notifications:</Text>
            </View>
          </View>
          {havePermNotification &&
          <View style={{flexDirection: 'row', alignItems: 'center', marginRight: 20}}>
            <Text style={{marginRight: 7, fontWeight: 'bold'}}>On</Text>
            <Icon name="check-circle" size={30} color="green" />
          </View>
          ||
          <TouchableOpacity style={{flexDirection: 'row', alignItems: 'center', marginRight: 20}}>
            <Text style={{marginRight: 7, fontWeight: 'bold'}}>Off</Text>
            <Icon name="times-circle" size={30} color="red" />
          </TouchableOpacity>
          }
        </View>

        <SettingsTextLabel title={"Based on your home address and party settings, we may push notifications to your device when there is an upcoming caucus or election that may be relevant to you."} />

        <SettingsDividerLong />

        <SettingsCategoryHeader title={"App Info"} />

        <SettingsDividerLong />

        <View style={{flexDirection: 'row', margin: 20}}>
          <View style={{flex: 1}}>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <Icon style={{marginRight: 10}} name="coffee" size={22} color="black" />
              <Text style={{fontSize: 20}}>Installed Version:</Text>
            </View>
          </View>
          <View style={{flexDirection: 'row', alignItems: 'center', marginRight: 20}}>
            <Text style={{marginRight: 7, fontWeight: 'bold'}}>{appVersion}</Text>
            <Icon name="github" size={30} onPress={() => openGitHub('HelloVoter')} />
          </View>
        </View>

        <SettingsTextLabel title={"This mobile app is open source! Your code contribution is welcome. Our goal is to update occasionally with new features that help every day people get involved with the political process."} />

        <SettingsDividerShort />

        <View style={{flexDirection: 'row', margin: 20}}>
          <View style={{flex: 1}}>
            <View style={{flexDirection: 'row', alignItems: 'center'}}>
              <Icon style={{marginRight: 10}} name="folder-open" size={22} color="black" />
              <Text style={{fontSize: 20}}>App Data:</Text>
            </View>
          </View>
          <View style={{flexDirection: 'row', alignItems: 'center', marginRight: 20}}>
            <Text style={{marginRight: 7, fontWeight: 'bold'}}>Ok</Text>
            <Icon name="check-circle" size={30} color="green" />
          </View>
        </View>

        <SettingsTextLabel title={"We save your canvassing and profile data to your device. Clear data will remove all data for this app from your device."} />

        <View style={{flex: 1, alignItems: 'center'}}>
          <View style={{margin: 20, marginTop: 0}}>
            <Button block danger onPress={() => {
              this.alert(
                say((user.lastsmlogin?"logout":"cleardata")),
                say((user.lastsmlogin?"sure_you_wish_logout":"sure_you_clear_data")),
                {
                  title: say("yes"),
                  onPress: () => this._logout(),
                },
                {
                  title: say("cancel"),
                  onPress: () => this.setState({confirmDialog: false}),
                }
              );
            }}>
              <Icon style={{width: 20}} name="sign-out" size={22} color="black" />
              <Text>{say((user.lastsmlogin?"logout":"cleardata"))}</Text>
            </Button>

            <Text></Text>

            {__DEV__&&user.lastsmlogin&&
              <Button block danger onPress={() => {
                _saveJWT("eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6Imdvb2dsZTpleHBpcmVkIiwibmFtZSI6IkV4cGlyZWQgVXNlciIsImVtYWlsIjoiZXhwaXJlZEBleGFtcGxlLmNvbSIsImlzcyI6Im91cnZvaWNldXNhLm9yZyIsImlhdCI6MSwiZXhwIjoyLCJkaXNjbGFpbWVyIjoiQmxhaCBibGFoIGRpc2NsYWltZXIifQ.hKEGFLQQuzjJFozrPyYCTDrQrRq3_bg5ZIKg6765DEEq1xcuKluWVhWYC_VeepHiEg5w9J60wXsS05NCr_f79P6DG8dL5HYdCCR3f7oyLUxa8ZLhUXbSViV42ASdQyX3dY00r890uybpU0zWKGegLfpBaZRZgFb1j67tH1MHdL-mRPOSHLpCdKFtfPoqh_HizeKQssdw46kUZgTpudlyuFp5nD04YQCw_VUrvT2xX1Hh8ViXkQIUkCBtvooi5S-e61NBcKvNoxxu5qWxEYx7lJJDpCaLHXJliJEkv0we_TnNfiZyQHpYlgZoYl25F192uEvZmIxA0vProV__j0bZVg");
                this.goHome();
              }}>
                <Text>Expire my session</Text>
              </Button>
            }

          </View>
        </View>

        <Dialog
          visible={SmLoginScreen}
          onTouchOutside={() => this.setState({SmLoginScreen: false})}>
          <SmLogin refer={this} />
        </Dialog>

      </Content>

      <HVConfirmDialog refer={this} />

      <Footer>
        <FooterTab>
          <Button onPress={() => this.props.navigation.goBack()}>
            <Icon name="undo" size={25} />
            <Text>Go back</Text>
          </Button>
        </FooterTab>
      </Footer>
    </Container>
    );
  }

}

const colors = {
  white: "#FFFFFF",
  monza: "#C70039",
  switchEnabled: "#C70039",
  switchDisabled: "#efeff3",
  blueGem: "#27139A",
};
