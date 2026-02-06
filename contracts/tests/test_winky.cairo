use snforge_std::{
    declare, ContractClassTrait, DeclareResultTrait, start_cheat_caller_address,
    stop_cheat_caller_address, start_cheat_block_timestamp, spy_events,
    EventSpyAssertionsTrait,
};
use starknet::ContractAddress;
use winky::IWinkyBlinkDispatcher;
use winky::IWinkyBlinkDispatcherTrait;
use winky::WinkyBlink;

fn deploy_contract() -> ContractAddress {
    let contract = declare("WinkyBlink").unwrap().contract_class();
    let (contract_address, _) = contract.deploy(@array![]).unwrap();
    contract_address
}

fn USER1() -> ContractAddress {
    'user1'.try_into().unwrap()
}

fn USER2() -> ContractAddress {
    'user2'.try_into().unwrap()
}

// ============================================
// Basic Tests
// ============================================

#[test]
fn test_record_single_blink() {
    let contract_address = deploy_contract();
    let dispatcher = IWinkyBlinkDispatcher { contract_address };

    start_cheat_caller_address(contract_address, USER1());

    dispatcher.record_blink();

    assert!(dispatcher.get_user_blinks(USER1()) == 1, "User blinks should be 1");
    assert!(dispatcher.get_total_blinks() == 1, "Total blinks should be 1");
}

#[test]
fn test_record_multiple_blinks() {
    let contract_address = deploy_contract();
    let dispatcher = IWinkyBlinkDispatcher { contract_address };

    start_cheat_caller_address(contract_address, USER1());

    // Record 5 blinks
    dispatcher.record_blink();
    dispatcher.record_blink();
    dispatcher.record_blink();
    dispatcher.record_blink();
    dispatcher.record_blink();

    assert!(dispatcher.get_user_blinks(USER1()) == 5, "User blinks should be 5");
    assert!(dispatcher.get_total_blinks() == 5, "Total blinks should be 5");
}

#[test]
fn test_multiple_users() {
    let contract_address = deploy_contract();
    let dispatcher = IWinkyBlinkDispatcher { contract_address };

    // User 1 blinks 3 times
    start_cheat_caller_address(contract_address, USER1());
    dispatcher.record_blink();
    dispatcher.record_blink();
    dispatcher.record_blink();
    stop_cheat_caller_address(contract_address);

    // User 2 blinks 2 times
    start_cheat_caller_address(contract_address, USER2());
    dispatcher.record_blink();
    dispatcher.record_blink();
    stop_cheat_caller_address(contract_address);

    assert!(dispatcher.get_user_blinks(USER1()) == 3, "User1 blinks should be 3");
    assert!(dispatcher.get_user_blinks(USER2()) == 2, "User2 blinks should be 2");
    assert!(dispatcher.get_total_blinks() == 5, "Total blinks should be 5");
}

#[test]
fn test_initial_state() {
    let contract_address = deploy_contract();
    let dispatcher = IWinkyBlinkDispatcher { contract_address };

    assert!(dispatcher.get_user_blinks(USER1()) == 0, "Initial user blinks should be 0");
    assert!(dispatcher.get_total_blinks() == 0, "Initial total blinks should be 0");
}

// ============================================
// Event Tests
// ============================================

#[test]
fn test_blink_event_emitted() {
    let contract_address = deploy_contract();
    let dispatcher = IWinkyBlinkDispatcher { contract_address };

    let mut spy = spy_events();

    start_cheat_caller_address(contract_address, USER1());
    start_cheat_block_timestamp(contract_address, 1234567890);

    dispatcher.record_blink();

    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    WinkyBlink::Event::Blink(
                        WinkyBlink::Blink {
                            user: USER1(),
                            timestamp: 1234567890,
                            user_total: 1,
                            global_total: 1,
                        },
                    ),
                ),
            ],
        );
}

#[test]
fn test_blink_event_increments() {
    let contract_address = deploy_contract();
    let dispatcher = IWinkyBlinkDispatcher { contract_address };

    let mut spy = spy_events();

    start_cheat_caller_address(contract_address, USER1());
    start_cheat_block_timestamp(contract_address, 1000);

    // First blink
    dispatcher.record_blink();

    // Second blink
    dispatcher.record_blink();

    // Check second event has correct totals
    spy
        .assert_emitted(
            @array![
                (
                    contract_address,
                    WinkyBlink::Event::Blink(
                        WinkyBlink::Blink {
                            user: USER1(),
                            timestamp: 1000,
                            user_total: 2,
                            global_total: 2,
                        },
                    ),
                ),
            ],
        );
}
